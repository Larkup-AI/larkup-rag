'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { CrawlJob, DataGroup, SourceDocument, IndexRun, RagConfig } from '@larkup/core/types';
import { Globe, FileUp, Type, Image, Plug, History, Loader2, Plus, KeyRound } from 'lucide-react';
import { ScrapePanel } from '@/components/data/scrape-panel';
import { WebCrawlerStatus } from '@/components/data/web-crawler-status';
import { PastePanel } from '@/components/data/paste-panel';
import { UploadPanel } from '@/components/data/upload-panel';
import { MediaPanel } from '@/components/data/media-panel';
import { IntegrationsPanel } from '@/components/data/integrations-panel';
import { JobsPanel } from '@/components/data/jobs-panel';
import {
  isActiveMediaIndexing,
  MediaIndexingJobsPanel,
  type MediaIndexingResponse,
} from '@/components/data/media-indexing-jobs-panel';
import { CorpusPanel } from '@/components/data/corpus-panel';
import type { DataPrimaryAction } from '@/components/data/data-primary-action';
import { useProject } from '@/components/projects/project-provider';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectTrigger } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { videoRuntimeScopeFromConfig } from '@/lib/media/video-runtime-scope';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface DocsResponse {
  documents: SourceDocument[];
  groups: DataGroup[];
  stats: {
    docCount: number;
    charCount: number;
    bySource: Record<string, number>;
  };
}

async function fetchJobsWithSync(url: string): Promise<{
  jobs: CrawlJob[];
  configured: boolean;
}> {
  const { jobs, configured } = (await fetcher(url)) as {
    jobs: CrawlJob[];
    configured: boolean;
  };
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  if (active.length === 0) return { jobs, configured };

  const advanced = await Promise.all(
    active.map((j) =>
      fetch(`/api/jobs/${j.id}`)
        .then((r) => r.json())
        .then((d) => d.job as CrawlJob)
        .catch(() => j),
    ),
  );
  const map = new Map(advanced.map((j) => [j.id, j]));
  return { jobs: jobs.map((j) => map.get(j.id) ?? j), configured };
}

const SUB_TABS = [
  { id: 'files', label: 'Files', icon: FileUp },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'website', label: 'Website', icon: Globe },
  { id: 'media', label: 'Media', icon: Image },
  { id: 'integrations', label: 'Integrations', icon: Plug },
] as const;

type TopTabId = 'add' | 'corpus';
type SubTabId = (typeof SUB_TABS)[number]['id'];

const SUB_TAB_INTRO: Record<SubTabId, { title: string; description: string }> = {
  files: {
    title: 'Add Files',
    description: 'Upload PDFs, documents, spreadsheets, CSVs, JSON files, and more.',
  },
  text: {
    title: 'Add Text',
    description: 'Paste notes, documentation, transcripts, or any text you want to search.',
  },
  website: {
    title: 'Add Websites',
    description: 'Add a URL or discover and crawl websites for your knowledge base.',
  },
  media: {
    title: 'Add Media',
    description: 'Upload images, audio, and video, or add media from a URL.',
  },
  integrations: {
    title: 'Add Integrations',
    description: 'Connect your tools and import the data your team already uses.',
  },
};

export function DataWorkspace({ view }: { view?: TopTabId } = {}) {
  const searchParams = useSearchParams();
  const queryGroupId = searchParams.get('groupId') ?? 'default';
  const pathname = usePathname();
  const { activeProject } = useProject();
  const serverId = activeProject?.id;

  const getInitialTab = (): TopTabId => {
    if (view) return view;
    return 'add';
  };

  const getInitialSubTab = (): SubTabId => {
    const subtab = searchParams.get('subtab') as SubTabId;
    if (subtab && SUB_TABS.some((t) => t.id === subtab)) return subtab;
    return 'files';
  };

  const [activeTab, setActiveTabState] = useState<TopTabId>(getInitialTab());
  const [activeSubTab, setActiveSubTabState] = useState<SubTabId>(getInitialSubTab());
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    queryGroupId && queryGroupId !== 'default' ? queryGroupId.split(',') : [],
  );

  useEffect(() => {
    if (view) {
      setActiveTabState(view);
      return;
    }
    const subtab = searchParams.get('subtab') as SubTabId;
    if (subtab && subtab !== activeSubTab && SUB_TABS.some((t) => t.id === subtab)) {
      setActiveSubTabState(subtab);
    }
  }, [searchParams, activeTab, activeSubTab, view]);

  useEffect(
    () =>
      setSelectedGroupIds(
        queryGroupId && queryGroupId !== 'default' ? queryGroupId.split(',') : [],
      ),
    [queryGroupId],
  );

  const setActiveSubTab = (subtab: SubTabId) => {
    // The outgoing panel owns the shared primary action. Clear it before changing
    // tabs so the incoming panel can register its action after it mounts.
    // Clearing it in an effect races with that registration on initial render.
    setPrimaryAction(null);
    setActiveSubTabState(subtab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('subtab', subtab);
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
  };
  const [showJobsDrawer, setShowJobsDrawer] = useState(false);
  const [primaryAction, setPrimaryAction] = useState<DataPrimaryAction | null>(null);
  const registerPrimaryAction = useCallback((action: DataPrimaryAction | null) => {
    setPrimaryAction(action);
  }, []);
  const prevJobsRef = useRef<CrawlJob[]>([]);
  const pendingIndexRef = useRef(false);

  const jobsQuery = useSWR('/api/jobs', fetchJobsWithSync, {
    refreshInterval: (data) =>
      data?.jobs.some((j) => j.status === 'running' || j.status === 'queued') ? 4000 : 0,
  });
  const jobs = jobsQuery.data?.jobs ?? [];
  const hasActiveCrawlJobs = jobs.some((j) => j.status === 'running' || j.status === 'queued');

  const indexQuery = useSWR<{
    unindexedCount: number;
    running: boolean;
    run: IndexRun | null;
    blockers: string[];
  }>('/api/index', fetcher, {
    refreshInterval: (d) => (d?.running ? 2000 : 0),
  });
  const indexRunning = indexQuery.data?.running ?? false;
  const dataAddBlocked = indexQuery.data?.blockers?.includes('MISSING_EMBEDDING_API_KEY') ?? false;
  const { mutate: mutateIndex } = indexQuery;

  const mediaQuery = useSWR<MediaIndexingResponse>(
    `/api/media?type=all${serverId ? `&serverId=${encodeURIComponent(serverId)}` : ''}`,
    fetcher,
    {
      refreshInterval: (data) => (data?.assets.some(isActiveMediaIndexing) ? 2_000 : 8_000),
      revalidateOnFocus: true,
    },
  );
  const activeMediaAssets = (mediaQuery.data?.assets ?? []).filter(isActiveMediaIndexing);
  const hasActiveMedia = activeMediaAssets.length > 0;
  const hasActive = hasActiveCrawlJobs || hasActiveMedia || indexRunning;
  const activeCrawlTargetCount = jobs
    .filter((job) => job.status === 'running' || job.status === 'queued')
    .reduce((count, job) => count + (job.targets?.length || 1), 0);
  const activeJobCount = activeCrawlTargetCount + activeMediaAssets.length + (indexRunning ? 1 : 0);
  const hasJobsDrawerContent = jobs.length > 0 || hasActiveMedia || indexRunning;
  const activeOrAttentionJobs = jobs.filter((job) => job.status !== 'completed');
  const completedJobs = jobs.filter((job) => job.status === 'completed');
  const [jobsFilterTab, setJobsFilterTab] = useState<'running' | 'all'>('running');

  const docsQuery = useSWR<DocsResponse>('/api/documents', fetcher, {
    refreshInterval: hasActive ? 5000 : 0,
  });
  const { mutate: mutateDocuments } = docsQuery;
  const documents = docsQuery.data?.documents ?? [];
  const groups = docsQuery.data?.groups ?? [];
  const configQuery = useSWR<{ config: RagConfig }>(
    `/api/config${serverId ? `?serverId=${encodeURIComponent(serverId)}` : ''}`,
    fetcher,
  );
  const activeVideoRuntimeScope = videoRuntimeScopeFromConfig(configQuery.data?.config);

  const selectedGroups = groups.filter((group) => selectedGroupIds.includes(group.id));
  // A source belongs to one group. Resolve the target from loaded data so a
  // deleted/stale URL parameter can never be submitted as an orphaned group.
  const targetGroupId = selectedGroups[0]?.id ?? 'default';

  useEffect(() => {
    if (dataAddBlocked) setPrimaryAction(null);
  }, [dataAddBlocked]);

  const { mutate: mutateGlobal } = useSWRConfig();

  const refreshAll = async () => {
    await Promise.all([
      jobsQuery.mutate(),
      mediaQuery.mutate(),
      docsQuery.mutate(),
      indexQuery.mutate(),
      mutateGlobal('/api/index'),
    ]);
  };

  const startAutomaticIndex = useCallback(async () => {
    try {
      const res = await fetch('/api/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incremental: Boolean(indexQuery.data?.run) }),
      });
      const body = await res.json();
      if (res.status === 409 || body.queued) {
        pendingIndexRef.current = res.status === 409;
        toast.message('Added to the indexing queue', {
          id: 'document-index-queued',
          description: 'It will start automatically after the current indexing job.',
        });
        void mutateIndex();
        return;
      }
      if (!res.ok) {
        toast.error(body.error || 'Your data was added, but indexing could not start.');
        return;
      }
      toast.success('Making your data searchable', {
        description: 'This runs in the background. You can keep adding files.',
        duration: 7_000,
      });
      pendingIndexRef.current = false;
      void mutateIndex();
    } catch {
      toast.error('Your data was added, but indexing could not start.');
    }
  }, [indexQuery.data?.run, mutateIndex]);

  const prevIndexRunning = useRef(indexRunning);
  useEffect(() => {
    if (prevIndexRunning.current && !indexRunning) {
      void mutateDocuments();
      // Compatibility with an older local server that still returns 409.
      // Current servers own this queue durably and start the follow-up pass.
      if (pendingIndexRef.current) {
        pendingIndexRef.current = false;
        void startAutomaticIndex();
      }
    }
    prevIndexRunning.current = indexRunning;
  }, [indexRunning, mutateDocuments, startAutomaticIndex]);

  useEffect(() => {
    const prevJobs = prevJobsRef.current;
    if (prevJobs.length > 0 && jobs.length > 0) {
      const justCompleted = jobs.filter(
        (j) =>
          j.status === 'completed' &&
          prevJobs.some(
            (pj) => pj.id === j.id && (pj.status === 'running' || pj.status === 'queued'),
          ),
      );

      if (justCompleted.length > 0) {
        toast.success('Scraping completed. Making the new pages searchable…');
        void mutateDocuments();
        setTimeout(() => void mutateDocuments(), 2500);
        void startAutomaticIndex();
      }
    }
    prevJobsRef.current = jobs;
  }, [jobs, mutateDocuments, startAutomaticIndex]);

  const handleDataAdded = () => {
    refreshAll();
    void startAutomaticIndex();
  };

  const handleScrapeStarted = useCallback(
    (job: CrawlJob) => {
      void jobsQuery.mutate(
        (current) => ({
          jobs: [job, ...(current?.jobs ?? []).filter((existing) => existing.id !== job.id)],
          configured: current?.configured ?? true,
        }),
        { revalidate: true },
      );
    },
    [jobsQuery],
  );

  const handleMediaIndexed = useCallback(() => {
    void mutateDocuments();
    void mutateIndex();
    toast.success('Media indexed and added to your Knowledge Base.');
  }, [mutateDocuments, mutateIndex]);

  const handleMediaProcessingStarted = useCallback(() => {
    void mediaQuery.mutate();
  }, [mediaQuery]);

  const activeSubTabIntro = SUB_TAB_INTRO[activeSubTab];

  const toggleGroup = (groupId: string) => {
    const next = groupId === 'default' || selectedGroupIds[0] === groupId ? [] : [groupId];
    setSelectedGroupIds(next);

    const params = new URLSearchParams(searchParams.toString());
    if (next.length > 0) params.set('groupId', next.join(','));
    else params.delete('groupId');
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
  };

  return (
    <div className="px-6 md:px-8">
      {view === 'add' && (
        <>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                {activeSubTabIntro.title}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{activeSubTabIntro.description}</p>
            </div>

            <div className="flex items-center gap-2">
              {activeSubTab === 'website' && <WebCrawlerStatus />}
              {hasJobsDrawerContent && (
                <TooltipProvider delay={150}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={() => setShowJobsDrawer(!showJobsDrawer)}
                          className={cn(
                            'relative cursor-pointer flex size-9 items-center justify-center rounded-lg border transition-colors',
                            hasActive
                              ? 'border-green-600 bg-green-100/30 text-green-600 hover:bg-green-100/50'
                              : 'border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                            showJobsDrawer && 'bg-white hover:bg-white',
                          )}
                          aria-label="Toggle jobs panel"
                        >
                          <History className="size-4" />
                          {hasActive && (
                            <>
                              <span className="absolute -top-1 -right-1 z-10 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-white shadow-sm ring-1 ring-white">
                                {activeJobCount}
                              </span>
                              <span className="absolute -top-1 -right-1 z-0 flex h-3.5 w-3.5 animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                            </>
                          )}
                        </button>
                      }
                    />
                    <TooltipContent>
                      <p>{hasActive ? 'Active jobs' : 'Job history'}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
          <div className="mb-4 pb-0 mt-9 flex items-center justify-between border-b border-border">
            <div className="-mb-1.5  flex items-center gap-1">
              {SUB_TABS.map((tab) => {
                const isActive = activeSubTab === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveSubTab(tab.id)}
                    className={cn(
                      'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors outline-none',
                      isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                    {tab.label}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2 motion-safe:duration-200"
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 pb-1.5">
              <Select>
                <SelectTrigger
                  aria-label="Data group"
                  className="h-9 min-w-42 max-w-56 bg-white text-xs"
                >
                  <span className="flex flex-1 items-center gap-1.5 truncate text-left">
                    {selectedGroups.length === 0
                      ? 'Default group'
                      : selectedGroups.length === 1
                        ? `${selectedGroups[0].icon ? `${selectedGroups[0].icon} ` : ''}${
                            selectedGroups[0].name
                          }`
                        : 'Default group'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <div className="p-1 space-y-1">
                    {groups.map((group) => (
                      <div
                        key={group.id}
                        className={cn(
                          'flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent',
                          selectedGroupIds.includes(group.id) && 'bg-accent/50',
                        )}
                        onClick={() => toggleGroup(group.id)}
                      >
                        <div className="flex size-4 items-center justify-center rounded-full border border-primary/50 shrink-0">
                          {selectedGroupIds.includes(group.id) && (
                            <div className="size-2 rounded-full bg-primary" />
                          )}
                        </div>
                        <span className="truncate">
                          {group.icon ? `${group.icon} ` : ''}
                          {group.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </SelectContent>
              </Select>
              {primaryAction && (
                <Button
                  size="default"
                  className={'h-10'}
                  onClick={primaryAction.onClick}
                  disabled={dataAddBlocked || primaryAction.disabled || primaryAction.loading}
                >
                  {primaryAction.loading ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 size-3.5" />
                  )}
                  {primaryAction.label}
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {showJobsDrawer && hasJobsDrawerContent && (
        <div className="mb-6 animate-in slide-in-from-top-2 fade-in duration-200">
          <div
            className={cn(
              'rounded-lg border border-border bg-card/70 p-4',
              jobs?.length == 0 && 'bg-background',
            )}
          >
            <div className="flex items-center justify-end mb-3">
              <button
                type="button"
                onClick={() => setShowJobsDrawer(false)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Hide
              </button>
            </div>
            <MediaIndexingJobsPanel assets={activeMediaAssets} />
            {indexRunning && (
              <div
                className={cn(
                  'flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5',
                  activeMediaAssets.length > 0 && 'mt-3',
                )}
              >
                <Loader2 className="size-4 shrink-0 animate-spin text-emerald-600" />
                <div className="min-w-0">
                  <p className="text-xs font-medium">Indexing files</p>
                  <p className="text-[11px] text-muted-foreground">
                    Running in the background — new files will join the queue.
                  </p>
                </div>
              </div>
            )}
            {jobs.length > 0 && (
              <div
                className={cn(activeMediaAssets.length > 0 && 'mt-4 border-t border-border pt-4')}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {[
                    { id: 'running', label: 'Running' },
                    { id: 'all', label: 'All Jobs' },
                  ].map((tab) => {
                    const isActive = jobsFilterTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setJobsFilterTab(tab.id as 'running' | 'all')}
                        className={cn(
                          'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                          isActive
                            ? 'bg-muted text-foreground'
                            : 'border border-border bg-transparent text-muted-foreground hover:bg-muted/50',
                        )}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
                <JobsPanel
                  jobs={
                    jobsFilterTab === 'running'
                      ? jobs.filter((j) => j.status === 'running' || j.status === 'queued')
                      : jobs
                  }
                  onChanged={refreshAll}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        {activeTab === 'add' && (
          <div className="w-full ">
            <div className="relative">
              {dataAddBlocked ? (
                <div className="mx-auto flex min-h-72 max-w-xl mt-5 flex-col items-center justify-center rounded-xl px-6 text-center">
                  <div className="mb-4 rounded-full bg-primary/10 p-3 text-primary">
                    <KeyRound className="size-5" />
                  </div>
                  <h2 className="text-base font-semibold">Set an embedding API key first</h2>
                  <p className="mt-2 max-w-md text-sm text-muted-foreground">
                    Data is kept out of the Knowledge Base until it can be indexed. Configure an
                    embedding provider and API key, then return here to add data.
                  </p>
                  <Link
                    href="/settings?section=models"
                    className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Open AI model settings
                  </Link>
                </div>
              ) : (
                <>
                  {activeSubTab === 'website' && (
                    <div className="w-full flex flex-col gap-8 animate-in fade-in duration-200">
                      <div>
                        <ScrapePanel
                          onStarted={handleScrapeStarted}
                          onActionChange={registerPrimaryAction}
                          groupId={targetGroupId}
                        />
                      </div>
                    </div>
                  )}

                  {activeSubTab === 'files' && (
                    <div className="animate-in fade-in duration-200">
                      <UploadPanel
                        onAdded={handleDataAdded}
                        onActionChange={registerPrimaryAction}
                        groupId={targetGroupId}
                      />
                    </div>
                  )}

                  {activeSubTab === 'text' && (
                    <div className=" animate-in fade-in duration-200">
                      <PastePanel
                        onAdded={handleDataAdded}
                        onActionChange={registerPrimaryAction}
                        groupId={targetGroupId}
                      />
                    </div>
                  )}

                  {activeSubTab === 'media' && (
                    <div className="animate-in fade-in duration-200">
                      <MediaPanel
                        onAdded={refreshAll}
                        onIndexed={handleMediaIndexed}
                        onProcessingStarted={handleMediaProcessingStarted}
                        onActionChange={registerPrimaryAction}
                        groupId={targetGroupId}
                      />
                    </div>
                  )}

                  {activeSubTab === 'integrations' && (
                    <div className="animate-in fade-in duration-200">
                      <IntegrationsPanel onAdded={handleDataAdded} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === 'corpus' && (
          <div className="animate-in fade-in duration-300">
            <CorpusPanel
              documents={documents}
              groups={groups}
              onChanged={refreshAll}
              isIndexing={indexRunning}
              activeVideoRuntimeScope={activeVideoRuntimeScope}
            />
          </div>
        )}
      </div>
    </div>
  );
}
