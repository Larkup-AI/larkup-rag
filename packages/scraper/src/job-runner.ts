import type { CrawlJob, CrawlJobStatus, CrawlTarget } from '@larkup/core/types';
import { getJob, updateJob } from '@larkup/core/jobs-store';
import { addCrawledDocuments, type NewDocumentInput } from '@larkup/core/documents-store';
import { cancelCrawl, getCrawlStatus, scrapePage, startCrawl } from './firecrawl';
import { isBotProtectionPage } from './bot-protection';

/**
 * Drives a crawl job forward by one increment.
 *
 * The toolkit is "pull-based": each call to `syncJob` advances every target a
 * little (start it, or poll it and persist any new pages), then returns the
 * latest job state. The UI polls this via the job status route, which is how a
 * multi-hour crawl streams documents into the corpus without a dedicated
 * worker process — perfect for both local runs and serverless.
 */

/** Max Firecrawl result pages to pull per sync, to keep each call snappy. */
const MAX_PAGES_PER_SYNC = 5;

const inFlight = new Set<string>();

export function isBlockedPage(content: string): boolean {
  return isBotProtectionPage(content);
}

function rollUpStatus(targets: CrawlTarget[]): CrawlJobStatus {
  if (targets.every((t) => t.status === 'completed')) return 'completed';
  if (targets.every((t) => t.status === 'failed')) return 'failed';
  if (
    targets.every((t) => t.status === 'completed' || t.status === 'failed') &&
    targets.some((t) => t.status === 'completed')
  ) {
    return 'completed';
  }
  return 'running';
}

async function advancePageTarget(
  jobId: string,
  target: CrawlTarget,
  groupId?: string,
): Promise<{ target: CrawlTarget; added: number }> {
  try {
    const page = await scrapePage(target.url);
    if (isBlockedPage(page.markdown)) {
      throw new Error('Scraping blocked by anti-bot protection (e.g. Cloudflare)');
    }
    const added = await addCrawledDocuments(jobId, [
      { title: page.title, url: page.url, content: page.markdown, source: 'website', groupId },
    ]);
    return {
      added,
      target: { ...target, status: 'completed', pagesCrawled: page.markdown ? 1 : 0 },
    };
  } catch (err) {
    return {
      added: 0,
      target: {
        ...target,
        status: 'failed',
        error: err instanceof Error ? err.message : 'scrape failed',
      },
    };
  }
}

async function advanceDomainTarget(
  jobId: string,
  target: CrawlTarget,
  pageLimit: number,
  groupId?: string,
): Promise<{ target: CrawlTarget; added: number }> {
  try {
    // Start the crawl on first touch.
    if (!target.firecrawlId) {
      const id = await startCrawl(target.url, pageLimit);
      return { added: 0, target: { ...target, firecrawlId: id, status: 'running' } };
    }

    let cursor = target.firecrawlId;
    let isCursor = false;
    let pulled = 0;
    let totalAdded = 0;
    let pagesCrawled = target.pagesCrawled;
    let state: CrawlTarget['status'] = 'running';
    const batch: NewDocumentInput[] = [];

    while (pulled < MAX_PAGES_PER_SYNC) {
      const status = await getCrawlStatus(cursor, isCursor);
      pagesCrawled = status.completed || pagesCrawled;
      for (const p of status.pages) {
        if (!isBlockedPage(p.markdown)) {
          batch.push({
            title: p.title,
            url: p.url,
            content: p.markdown,
            source: 'website',
            groupId,
          });
        }
      }
      pulled++;

      if (status.state === 'completed') state = 'completed';
      else if (status.state === 'failed') {
        state = 'failed';
        target = {
          ...target,
          error: status.error || 'The crawl did not return any readable pages.',
        };
      } else if (status.state === 'cancelled') state = 'cancelled';

      if (status.next) {
        cursor = status.next;
        isCursor = true;
      } else {
        break;
      }
    }

    if (batch.length) totalAdded = await addCrawledDocuments(jobId, batch);

    return { added: totalAdded, target: { ...target, status: state, pagesCrawled } };
  } catch (err) {
    // Native crawls run without a separate service. If an older release lost
    // its shared state file (for example when several jobs were launched at
    // once), keep the durable job alive and create a fresh crawl on its next
    // status poll instead of presenting a permanent, misleading failure.
    if (
      target.firecrawlId?.startsWith('native-') &&
      err instanceof Error &&
      err.message === 'Native crawl was not found.'
    ) {
      return {
        added: 0,
        target: {
          ...target,
          firecrawlId: undefined,
          status: 'running',
          error: 'Restarting the local crawl…',
        },
      };
    }
    return {
      added: 0,
      target: {
        ...target,
        status: 'failed',
        error: err instanceof Error ? err.message : 'crawl failed',
      },
    };
  }
}

/**
 * Advance a job by one increment and persist the result. Safe to call
 * repeatedly (polling); no-ops on terminal jobs.
 */
export async function syncJob(id: string): Promise<CrawlJob | undefined> {
  const existing = await getJob(id);
  if (!existing) return undefined;
  if (['completed', 'failed', 'cancelled'].includes(existing.status)) {
    return existing;
  }
  if (inFlight.has(id)) return existing;
  inFlight.add(id);

  try {
    // Advance every non-terminal target.
    const results = await Promise.all(
      existing.targets.map((t) => {
        if (t.status === 'completed' || t.status === 'failed') {
          return Promise.resolve({ target: t, added: 0 });
        }
        return t.scope === 'page'
          ? advancePageTarget(id, t, existing.groupId)
          : advanceDomainTarget(id, t, existing.pageLimit, existing.groupId);
      }),
    );

    const nextTargets = results.map((r) => r.target);
    const pagesCrawled = nextTargets.reduce((s, t) => s + t.pagesCrawled, 0);

    return await updateJob(id, (job) => ({
      ...job,
      targets: nextTargets,
      pagesCrawled,
      docCount: job.docCount + results.reduce((s, r) => s + r.added, 0),
      status: rollUpStatus(nextTargets),
    }));
  } finally {
    inFlight.delete(id);
  }
}

/** Cancel a job: stop Firecrawl crawls and mark everything cancelled. */
export async function cancelJob(id: string): Promise<CrawlJob | undefined> {
  const job = await getJob(id);
  if (!job) return undefined;
  await Promise.all(
    job.targets
      .filter((t) => t.firecrawlId && t.status === 'running')
      .map((t) => cancelCrawl(t.firecrawlId as string)),
  );
  return updateJob(id, (j) => ({
    ...j,
    status: 'cancelled',
    targets: j.targets.map((t) =>
      t.status === 'running' || t.status === 'queued'
        ? { ...t, status: 'cancelled' as CrawlJobStatus }
        : t,
    ),
  }));
}
