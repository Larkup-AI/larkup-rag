import type { SearchResultItem } from '@larkup/core/types';
import { readConfig } from '@larkup/core/config-store';
import { readLocalState } from './local-runtime';
import {
  cancelNativeCrawl,
  getNativeCrawlStatus,
  nativeSearchWeb,
  nativeScrapePage,
  startNativeCrawl,
} from './native-crawler';
import { isBotProtectionPage } from './bot-protection';

/**
 * Minimal, dependency-free Firecrawl v1 client.
 *
 * We talk to the REST API directly with `fetch` rather than pulling in an SDK,
 * keeping the toolkit lightweight. The scraper is intentionally isolated behind
 * this module so a different engine (Playwright, Crawl4AI, …) could be swapped
 * in later without touching the API routes or UI.
 *
 * Endpoint resolution order:
 *  1. A running LOCAL self-hosted instance (launched from the UI), or
 *  2. The Firecrawl cloud via FIRECRAWL_API_KEY.
 */

const CLOUD_BASE = 'https://api.firecrawl.dev/v1';

export class FirecrawlError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FirecrawlError';
  }
}

interface Endpoint {
  base: string;
  key: string;
  mode: 'local' | 'cloud' | 'native';
}

/** Resolve which Firecrawl to talk to based on config. */
async function resolveEndpoint(): Promise<Endpoint> {
  const config = await readConfig();
  const provider = config.webCrawlerProvider || 'local';

  if (provider === 'local') {
    const local = await readLocalState();
    if (local.running && local.apiKey) {
      if (local.mode === 'native' || local.endpoint.startsWith('native://')) {
        return { base: local.endpoint, key: local.apiKey, mode: 'native' };
      }
      return { base: `${local.endpoint}/v1`, key: local.apiKey, mode: 'local' };
    }
    // The built-in crawler has no process to launch. Fall back to it when an
    // old/stopped Firecrawl state exists so curl, CLI, desktop, and container
    // installs work without Docker or a setup click.
    return { base: 'native://larkup-crawler', key: 'native', mode: 'native' };
  }

  // cloud
  const key = config.firecrawlApiKey;
  if (key) return { base: CLOUD_BASE, key, mode: 'cloud' };

  throw new FirecrawlError('The cloud web crawler needs an API key. Add it in Settings.', 401);
}

/**
 * Whether web scraping is available based on selected provider.
 */
export async function isFirecrawlConfigured() {
  const config = await readConfig();
  const provider = config.webCrawlerProvider || 'local';

  if (provider === 'local') {
    return true;
  }

  return Boolean(config.firecrawlApiKey);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const { base, key } = await resolveEndpoint();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  const text = await res.text();
  const json = text ? safeParse(text) : {};

  if (!res.ok) {
    const msg = (json as { error?: string })?.error || `Firecrawl request failed (${res.status})`;
    throw new FirecrawlError(msg, res.status);
  }
  return json as T;
}

/** Fetch an absolute Firecrawl URL (used for pagination cursors). */
async function callAbsolute<T>(url: string): Promise<T> {
  const { key } = await resolveEndpoint();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
  });
  const text = await res.text();
  const json = text ? safeParse(text) : {};
  if (!res.ok) {
    const msg = (json as { error?: string })?.error || `Firecrawl request failed (${res.status})`;
    throw new FirecrawlError(msg, res.status);
  }
  return json as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

interface FcSearchResponse {
  success: boolean;
  data?: Array<{ url: string; title?: string; description?: string }>;
}

export async function searchWeb(query: string, limit = 10): Promise<SearchResultItem[]> {
  const endpoint = await resolveEndpoint();
  if (endpoint.mode === 'native') return nativeSearchWeb(query, limit);
  const json = await call<FcSearchResponse>('/search', {
    method: 'POST',
    body: JSON.stringify({ query, limit }),
  });
  return (json.data ?? []).map((r) => ({
    url: r.url,
    title: r.title || r.url,
    description: r.description,
  }));
}

export interface ScrapedPage {
  url: string;
  title: string;
  markdown: string;
}

interface FcScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    metadata?: { title?: string; sourceURL?: string; ogTitle?: string };
  };
}

const STEALTH_OPTIONS = {
  waitFor: 10000,
  onlyMainContent: false, // capture ALL content, not just what Firecrawl deems "main"
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
  },
};

export async function scrapePage(url: string): Promise<ScrapedPage> {
  const endpoint = await resolveEndpoint();
  if (endpoint.mode === 'native') {
    const page = await nativeScrapePage(url);
    return { url: page.url, title: page.title, markdown: page.markdown };
  }

  // A normal HTTP request is much faster and avoids launching Chromium for
  // ordinary, server-rendered pages. When it returns a bot challenge (or
  // cannot read the page), fall through to the local browser crawler.
  if (endpoint.mode === 'local') {
    try {
      const page = await nativeScrapePage(url);
      if (!isBotProtectionPage(page.markdown)) {
        return { url: page.url, title: page.title, markdown: page.markdown };
      }
    } catch {
      // The browser crawler gets a chance to handle JavaScript-only pages,
      // browser-specific navigation, and HTTP blocks.
    }
  }

  const json = await call<FcScrapeResponse>('/scrape', {
    method: 'POST',
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      ...STEALTH_OPTIONS,
    }),
  });
  const d = json.data ?? {};
  return {
    url: d.metadata?.sourceURL || url,
    title: d.metadata?.title || d.metadata?.ogTitle || url,
    markdown: d.markdown ?? '',
  };
}

interface FcCrawlStartResponse {
  success: boolean;
  id?: string;
}

/** Kick off an async crawl of an entire site. Returns the Firecrawl job id. */
export async function startCrawl(url: string, limit: number): Promise<string> {
  const endpoint = await resolveEndpoint();
  if (endpoint.mode === 'native') return startNativeCrawl(url, limit);
  const json = await call<FcCrawlStartResponse>('/crawl', {
    method: 'POST',
    body: JSON.stringify({
      url,
      limit,
      allowExternalLinks: false,
      scrapeOptions: {
        ...STEALTH_OPTIONS,
        formats: ['markdown'],
        onlyMainContent: true,
      },
    }),
  });
  if (!json.id) throw new FirecrawlError('Firecrawl did not return a crawl id');
  return json.id;
}

export type FcCrawlState = 'scraping' | 'completed' | 'failed' | 'cancelled';

export interface CrawlStatus {
  state: FcCrawlState;
  total: number;
  completed: number;
  pages: ScrapedPage[];
  /** cursor URL for the next page of results, if any */
  next?: string;
  error?: string;
}

interface FcCrawlStatusResponse {
  status: FcCrawlState;
  total?: number;
  completed?: number;
  next?: string;
  data?: Array<{
    markdown?: string;
    metadata?: { title?: string; sourceURL?: string; url?: string };
  }>;
  error?: string;
}

/**
 * Poll a crawl's status. `cursor` follows Firecrawl's pagination so callers can
 * pull freshly-scraped pages incrementally as a long crawl progresses.
 */
export async function getCrawlStatus(idOrCursor: string, isCursor = false): Promise<CrawlStatus> {
  if (!isCursor && idOrCursor.startsWith('native-')) {
    return getNativeCrawlStatus(idOrCursor);
  }
  const json = isCursor
    ? await callAbsolute<FcCrawlStatusResponse>(idOrCursor)
    : await call<FcCrawlStatusResponse>(`/crawl/${idOrCursor}`, {
        method: 'GET',
      });
  return {
    state: json.status ?? 'scraping',
    total: json.total ?? 0,
    completed: json.completed ?? 0,
    next: json.next,
    error: json.error,
    pages: (json.data ?? []).map((p) => ({
      url: p.metadata?.sourceURL || p.metadata?.url || '',
      title: p.metadata?.title || p.metadata?.sourceURL || 'Untitled',
      markdown: p.markdown ?? '',
    })),
  };
}

/** Cancel a running crawl on Firecrawl's side (best-effort). */
export async function cancelCrawl(id: string): Promise<void> {
  if (id.startsWith('native-')) {
    await cancelNativeCrawl(id);
    return;
  }
  try {
    await call(`/crawl/${id}`, { method: 'DELETE' });
  } catch {
    // best-effort; local job is cancelled regardless
  }
}
