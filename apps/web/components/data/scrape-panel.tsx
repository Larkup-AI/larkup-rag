'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { formatErrorMessage } from '@/lib/shared/error-formatter';
import {
  Globe,
  Loader2,
  Search,
  ChevronDown,
  ChevronsDown,
  Info,
  Clock,
  X,
  Trash2,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useScrapeStore, type SearchState } from '@/store/scrape-store';
import type { CrawlJob, CrawlScope, SearchResultItem } from '@larkup/core/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import type { RagConfig } from '@larkup/core/types';
import type { DataPrimaryAction } from '@/components/data/data-primary-action';

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

type LocalCrawlerState = {
  running: boolean;
  mode?: 'native' | 'firecrawl';
  lastError?: string;
};

type LocalCrawlerResponse = {
  state: LocalCrawlerState;
  starting?: boolean;
};

function domainOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `~${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)}min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  return `~${h}h ${m}min`;
}

/** Estimate ETL duration based on URL count, scope, and page limit */
function estimateEtlDuration(
  urlCount: number,
  scope: CrawlScope,
  pageLimit: number,
): { totalPages: number; estimatedSeconds: number } {
  const pagesPerUrl = scope === 'domain' ? pageLimit : 1;
  const totalPages = urlCount * pagesPerUrl;
  const perPageSeconds = scope === 'domain' ? 5 : 3;
  const estimatedSeconds = totalPages * perPageSeconds;
  return { totalPages, estimatedSeconds };
}

export function ScrapePanel({
  disabled,
  onStarted,
  onActionChange,
  groupId,
}: {
  disabled?: boolean;
  onStarted: (job: CrawlJob) => void;
  onActionChange?: (action: DataPrimaryAction | null) => void;
  groupId?: string;
}) {
  const router = useRouter();
  const {
    query,
    setQuery,
    searchState,
    setSearchState,
    selected,
    setSelected,
    scope,
    setScope,
    pageLimit,
    setPageLimit,
    searchLimit,
    setSearchLimit,
    showAdvanced,
    setShowAdvanced,
    serperTotalForQuery,
    setSerperTotalForQuery,
    flush: flushSearch,
  } = useScrapeStore();

  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [gatheringAll, setGatheringAll] = useState(false);
  const [gatherProgress, setGatherProgress] = useState(0);
  const [manualUrl, setManualUrl] = useState('');
  const [manualUrlList, setManualUrlList] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  /** When true: only the exact custom URLs are scraped — no deep crawl/pagination */
  const [specificUrls, setSpecificUrls] = useState(false);
  const [firecrawlConfigured, setFirecrawlConfigured] = useState<boolean | null>(null);
  const [crawlerState, setCrawlerState] = useState<LocalCrawlerState | null>(null);
  const [crawlerStarting, setCrawlerStarting] = useState(false);
  const crawlerPolling = useRef<Promise<boolean> | null>(null);
  const { data: configData } = useSWR('/api/config', fetcher);
  const activeProvider = configData?.config?.webSearchProvider || 'tavily';
  const crawlerProvider = configData?.config?.webCrawlerProvider || 'local';
  const [cachedQueries, setCachedQueries] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [displayPage, setDisplayPage] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  function showCrawlerSettings() {
    toast.error('Web crawler is not available. Choose a crawler provider in Settings.', {
      action: {
        label: 'Open settings',
        onClick: () => router.push('/settings?section=general#web-crawler'),
      },
    });
  }

  async function readCrawlerStatus(): Promise<LocalCrawlerResponse> {
    const res = await fetch('/api/firecrawl/local', { cache: 'no-store' });
    const body = (await res.json()) as LocalCrawlerResponse & { error?: string };
    if (!res.ok) throw new Error(body.error || 'Could not read crawler status.');
    setCrawlerState(body.state);
    setCrawlerStarting(Boolean(body.starting));
    return body;
  }

  function pollCrawlerUntilReady(): Promise<boolean> {
    if (crawlerPolling.current) return crawlerPolling.current;

    crawlerPolling.current = (async () => {
      for (let attempt = 0; attempt < 45; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const status = await readCrawlerStatus();
        if (status.state.running) return true;
        if (!status.starting) return false;
      }
      setCrawlerStarting(false);
      setCrawlerState((current) => ({
        ...(current ?? { running: false }),
        lastError: 'The browser crawler is still starting. Try again in a moment.',
      }));
      return false;
    })().finally(() => {
      crawlerPolling.current = null;
    });

    return crawlerPolling.current;
  }

  async function warmCrawler(): Promise<LocalCrawlerResponse | null> {
    if (crawlerProvider === 'cloud') return null;
    try {
      const res = await fetch('/api/firecrawl/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const body = (await res.json()) as LocalCrawlerResponse & { error?: string };
      if (!res.ok) throw new Error(body.error || 'Could not prepare the crawler.');
      setCrawlerState(body.state);
      setCrawlerStarting(Boolean(body.starting));
      if (body.starting) void pollCrawlerUntilReady();
      return body;
    } catch (error) {
      setCrawlerStarting(false);
      setCrawlerState((current) => ({
        ...(current ?? { running: false }),
        lastError: formatErrorMessage(error),
      }));
      return null;
    }
  }

  async function ensureCrawlerReady() {
    if (crawlerProvider === 'cloud') return true;
    if (crawlerState?.running) return true;

    const started = await warmCrawler();
    if (!started) return false;
    if (started.state.running) return true;
    // A first Chromium image pull can take a while. Keep warming it in the
    // background, but never make an "Add website" click look frozen; the
    // native crawler remains available as an immediate fallback.
    const ready = started.starting
      ? await Promise.race([
          pollCrawlerUntilReady(),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), 8_000)),
        ])
      : false;
    if (!ready && started.starting) return true;
    if (!ready) {
      toast.error(started.state.lastError || 'The website crawler is not ready yet.');
    }
    return ready;
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        inputRef.current &&
        !inputRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('scrape_recent_queries');
      if (saved) setCachedQueries(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, []);

  function saveQuery(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setCachedQueries((prev) => {
      const newCache = [trimmed, ...prev.filter((item) => item !== trimmed)].slice(0, 10);
      try {
        localStorage.setItem('scrape_recent_queries', JSON.stringify(newCache));
      } catch {
        // ignore
      }
      return newCache;
    });
  }

  function removeQuery(q: string, e: React.MouseEvent) {
    e.stopPropagation();
    setCachedQueries((prev) => {
      const newCache = prev.filter((item) => item !== q);
      try {
        localStorage.setItem('scrape_recent_queries', JSON.stringify(newCache));
      } catch {
        // ignore
      }
      return newCache;
    });
  }

  useEffect(() => {
    // Check Firecrawl
    fetch('/api/search')
      .then((r) => r.json())
      .then((d) => setFirecrawlConfigured(d.configured ?? false))
      .catch(() => setFirecrawlConfigured(false));
  }, []);

  useEffect(() => {
    if (crawlerProvider !== 'local') return;
    void (async () => {
      try {
        const status = await readCrawlerStatus();
        if (status.state.mode !== 'firecrawl' || !status.state.running) await warmCrawler();
      } catch {
        await warmCrawler();
      }
    })();
  }, [crawlerProvider]);

  const selectedUrls = useMemo(() => Object.keys(selected).filter((u) => selected[u]), [selected]);

  /** Search using Firecrawl (preferred — no Serper credits used for search). */
  async function searchFirecrawl(q: string, isMulti: boolean) {
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, limit: searchLimit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Search failed');
      const newItems = (data.results as SearchResultItem[]) ?? [];

      setSearchState((prev) => {
        const existingResults = prev ? prev.results : [];
        const existingUrls = new Set(existingResults.map((r) => r.url));
        const fresh = newItems.filter((r) => !existingUrls.has(r.url));
        return {
          results: [...existingResults, ...fresh],
          totalResults: isMulti ? (prev?.totalResults ?? 0) + fresh.length : fresh.length,
          totalResultsIsEstimate: false,
          currentPage: 1,
          totalPages: 1,
          hasMore: false,
          query: isMulti ? 'Multiple queries' : q,
          searchProvider: 'firecrawl',
        };
      });

      const newSelected = Object.fromEntries(newItems.map((r) => [r.url, true]));
      setSelected((prev) => ({ ...prev, ...newSelected }));

      if (newItems.length === 0 && !isMulti) toast.message('No results. Try different keywords.');

      if (activeProvider && !isMulti) {
        fetchProviderTotalCount(q, activeProvider);
      }
    } catch (err) {
      const message = formatErrorMessage(err);
      if (/crawler|firecrawl|not running|api key/i.test(message)) {
        showCrawlerSettings();
      } else {
        toast.error(message);
      }
    }
  }

  /** Search using generic provider. */
  async function searchGeneric(
    q: string,
    provider: string,
    page: number,
    isMulti: boolean,
    appendPagination = false,
  ) {
    if (appendPagination) {
      setLoadingMore(true);
    }

    const endpoint =
      provider === 'serper' || provider === 'google'
        ? '/api/search/google'
        : provider === 'brave'
          ? '/api/search/brave'
          : provider === 'bing'
            ? '/api/search/bing'
            : provider === 'tavily'
              ? '/api/search/tavily'
              : provider === 'exa'
                ? '/api/search/exa'
                : null;

    if (!endpoint) {
      toast.error('Invalid search provider');
      if (appendPagination) setLoadingMore(false);
      return;
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, page }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? 'Search failed');

      const newItems: SearchResultItem[] = (data.items ?? []).map(
        (item: { url: string; title: string; description?: string }) => ({
          url: item.url,
          title: item.title || item.url,
          description: item.description,
        }),
      );

      setSearchState((prev) => {
        const existingResults = prev ? prev.results : [];
        const existingUrls = new Set(existingResults.map((r) => r.url));
        const fresh = newItems.filter((r) => !existingUrls.has(r.url));
        return {
          results: [...existingResults, ...fresh],
          totalResults: (prev?.totalResults ?? 0) + (data.totalResults ?? 0),
          totalResultsIsEstimate: data.totalResultsIsEstimate ?? true,
          currentPage: data.currentPage ?? page,
          totalPages: data.totalPages ?? 1,
          hasMore: data.hasMore ?? false,
          query: data.query ?? q,
          searchProvider: provider as any,
        };
      });

      const newSelected = Object.fromEntries(newItems.map((r) => [r.url, true]));
      setSelected((prev) => ({ ...prev, ...newSelected }));

      if (!isMulti) {
        // Update total
        setSerperTotalForQuery({
          query: q,
          total: data.totalResults ?? 0,
          totalPages: data.totalPages ?? 1,
        });
      }

      if (page === 1 && newItems.length === 0 && !isMulti) {
        toast.message('No results. Try different keywords.');
      }
    } catch (err) {
      if (page === 1) throw err;
      toast.error(formatErrorMessage(err));
    } finally {
      if (appendPagination) setLoadingMore(false);
    }
  }

  /** Fetch total count from provider without using it for results (saves on Firecrawl credits) */
  async function fetchProviderTotalCount(q: string, provider: string) {
    const endpoint =
      provider === 'serper' || provider === 'google'
        ? '/api/search/google'
        : provider === 'brave'
          ? '/api/search/brave'
          : provider === 'bing'
            ? '/api/search/bing'
            : provider === 'tavily'
              ? '/api/search/tavily'
              : provider === 'exa'
                ? '/api/search/exa'
                : null;

    if (!endpoint) return;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, page: 1 }),
      });
      const data = await res.json();
      if (res.ok) {
        setSerperTotalForQuery({
          query: q,
          total: data.totalResults ?? 0,
          totalPages: data.totalPages ?? 1,
        });
      }
    } catch {
      // Silent fail — count is optional
    }
  }

  async function runSearch() {
    setShowDropdown(false);
    if (!query.trim()) {
      toast.error('Enter one or more keywords to search.');
      return;
    }

    setSerperTotalForQuery(null);
    saveQuery(query);

    const queries = query
      .split(',')
      .map((q) => q.trim())
      .filter(Boolean);
    if (queries.length === 0) return;

    setSearching(true);
    setDisplayPage(1);
    // Removed setSearchState(null) so we append instead of clear

    try {
      if (activeProvider === 'local' || !activeProvider) {
        if (!(await ensureCrawlerReady())) return;
        await Promise.all(queries.map((q) => searchFirecrawl(q, queries.length > 1)));
      } else {
        try {
          await Promise.all(
            queries.map((q) => searchGeneric(q, activeProvider, 1, queries.length > 1, false)),
          );
        } catch (err) {
          toast.info('Using local crawler…');
          if (!(await ensureCrawlerReady())) return;
          await Promise.all(queries.map((q) => searchFirecrawl(q, queries.length > 1)));
        }
      }
    } finally {
      setSearching(false);
    }
  }

  async function loadNextPage() {
    if (!searchState?.hasMore || loadingMore) return;
    if (searchState.searchProvider !== 'firecrawl') {
      await searchGeneric(
        searchState.query,
        searchState.searchProvider,
        searchState.currentPage + 1,
        false,
        true,
      );
    }
  }

  /** Automatically paginate through ALL available provider results. */
  async function gatherAll() {
    if (!searchState || searchState.searchProvider === 'firecrawl') return;
    setGatheringAll(true);
    setGatherProgress(searchState.currentPage);

    let page = searchState.currentPage + 1;
    const total = searchState.totalPages;
    const provider = searchState.searchProvider;

    const endpoint =
      provider === 'serper' || provider === 'google'
        ? '/api/search/google'
        : provider === 'brave'
          ? '/api/search/brave'
          : provider === 'bing'
            ? '/api/search/bing'
            : provider === 'tavily'
              ? '/api/search/tavily'
              : provider === 'exa'
                ? '/api/search/exa'
                : null;

    try {
      while (page <= total) {
        setGatherProgress(page);
        if (!endpoint) break;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: query.trim(), page }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Search failed');

        const newItems: SearchResultItem[] = (data.items ?? []).map(
          (item: { url: string; title: string; description?: string }) => ({
            url: item.url,
            title: item.title || item.url,
            description: item.description,
          }),
        );

        setSearchState((prev) => {
          if (!prev) return prev;
          const existingUrls = new Set(prev.results.map((r) => r.url));
          const fresh = newItems.filter((r) => !existingUrls.has(r.url));
          return {
            ...prev,
            results: [...prev.results, ...fresh],
            totalResultsIsEstimate: data.totalResultsIsEstimate ?? prev.totalResultsIsEstimate,
            currentPage: data.currentPage ?? page,
            totalPages: data.totalPages ?? prev.totalPages,
            hasMore: data.hasMore ?? false,
          };
        });

        const newSelected = Object.fromEntries(newItems.map((r) => [r.url, true]));
        setSelected((prev) => ({ ...prev, ...newSelected }));

        if (!data.hasMore) break;
        page++;
        await new Promise((r) => setTimeout(r, 300));
      }
      toast.success('All available results gathered!');
    } catch (err) {
      toast.error(formatErrorMessage(err));
    } finally {
      setGatheringAll(false);
      setGatherProgress(0);
    }
  }

  function appendManualUrl() {
    const urls = manualUrl
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u));

    if (urls.length > 0) {
      setManualUrlList((prev) => Array.from(new Set([...prev, ...urls])));
      setManualUrl('');
    } else {
      toast.error('Enter at least one full URL starting with http(s)://');
    }
  }

  function addManual() {
    const currentUrls = manualUrl
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u));

    const allUrls = Array.from(new Set([...manualUrlList, ...currentUrls]));

    if (allUrls.length === 0) {
      toast.error('Enter at least one full URL starting with http(s)://');
      return;
    }

    void startJob(allUrls, true).then((success) => {
      if (success) {
        setManualUrl('');
        setManualUrlList([]);
      }
    });
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        setManualUrl((prev) => prev + (prev ? '\n' : '') + text);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // reset input
  };

  /** Open confirm modal before starting ETL */
  function handleStartClick() {
    if (selectedUrls.length === 0) {
      toast.error('Select at least one URL to scrape.');
      return;
    }
    void startJob();
  }

  async function startJob(urls = selectedUrls, exactUrls = false) {
    setStarting(true);
    const effectiveScope: CrawlScope = specificUrls || exactUrls ? 'page' : scope;
    try {
      if (!(await ensureCrawlerReady())) return;
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: query || urls[0],
          pageLimit: specificUrls || exactUrls ? 1 : pageLimit,
          targets: urls.map((url) => ({ url, scope: effectiveScope })),
          groupId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.code === 'already_scraped') {
          toast.info('Already in your knowledge base', {
            description: 'This URL has already been scraped and added.',
          });
          return false;
        }
        throw new Error(data.error ?? 'Could not start job');
      }

      toast.success('Website added', {
        description: 'We’ll finish it in the background.',
        duration: 8000,
      });

      setSelected({});
      setSearchState((prev) => {
        if (!prev) return prev;
        const urlSet = new Set(urls);
        return {
          ...prev,
          results: prev.results.filter((r) => !urlSet.has(r.url)),
        };
      });
      onStarted(data.job as CrawlJob);
      return true;
    } catch (err) {
      toast.error(formatErrorMessage(err));
      return false;
    } finally {
      setStarting(false);
    }
  }

  const results = searchState?.results ?? [];
  const gatherAllAvailable =
    searchState?.searchProvider !== 'firecrawl' && searchState?.hasMore && !gatheringAll;

  const ITEMS_PER_PAGE = 5;
  const totalDisplayPages = Math.max(1, Math.ceil(results.length / ITEMS_PER_PAGE));
  const currentDisplayResults = results.slice(
    (displayPage - 1) * ITEMS_PER_PAGE,
    displayPage * ITEMS_PER_PAGE,
  );

  useEffect(() => {
    if (displayPage > totalDisplayPages && totalDisplayPages > 0) {
      setDisplayPage(totalDisplayPages);
    }
  }, [totalDisplayPages, displayPage]);

  const [manualUrlPage, setManualUrlPage] = useState(1);
  const MANUAL_URL_PAGE_SIZE = 10;
  const totalManualPages = Math.max(1, Math.ceil(manualUrlList.length / MANUAL_URL_PAGE_SIZE));
  const currentManualUrls = manualUrlList.slice(
    (manualUrlPage - 1) * MANUAL_URL_PAGE_SIZE,
    manualUrlPage * MANUAL_URL_PAGE_SIZE,
  );

  useEffect(() => {
    if (manualUrlPage > totalManualPages && totalManualPages > 0) {
      setManualUrlPage(totalManualPages);
    }
  }, [totalManualPages, manualUrlPage]);

  // Estimate for confirmation modal
  const effectiveScopeForEstimate: CrawlScope = specificUrls ? 'page' : scope;
  const estimate = useMemo(
    () =>
      estimateEtlDuration(
        selectedUrls.length,
        effectiveScopeForEstimate,
        specificUrls ? 1 : pageLimit,
      ),
    [selectedUrls.length, effectiveScopeForEstimate, specificUrls, pageLimit],
  );

  const [inputMode, setInputMode] = useState<'search' | 'url'>('url');

  useEffect(() => {
    const hasSelection = selectedUrls.length > 0;
    const isUrl = inputMode === 'url';
    const currentUrls = manualUrl.split(/[\s,]+/).filter((u) => /^https?:\/\//i.test(u));
    const allUrls = Array.from(new Set([...manualUrlList, ...currentUrls]));
    const urlCount = allUrls.length;

    onActionChange?.({
      label: isUrl
        ? urlCount > 1
          ? 'Add websites'
          : 'Add website'
        : hasSelection
          ? 'Add selected'
          : 'Search topic',
      onClick: () => {
        if (isUrl) void addManual();
        else if (hasSelection) handleStartClick();
        else void runSearch();
      },
      disabled: disabled || (isUrl ? urlCount === 0 : !hasSelection && !query.trim()),
      loading: searching || starting,
    });
    return () => onActionChange?.(null);
  }, [
    disabled,
    inputMode,
    manualUrl,
    manualUrlList,
    query,
    searching,
    starting,
    selectedUrls.length,
    onActionChange,
  ]);

  return (
    <div className="space-y-4">
      {/* Unified input area */}
      <div className="space-y-3">
        {/* Mode toggle + input */}
        <div className="flex items-center gap-2">
          <Tabs
            value={inputMode}
            onValueChange={(v) => setInputMode(v as 'search' | 'url')}
            className="shrink-0"
          >
            <TabsList className="inline-flex bg-white/70 h-9 items-center justify-center rounded-lg  border border-border p-0.5 text-muted-foreground">
              <TabsTrigger
                value="url"
                className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]: hover:text-foreground"
              >
                <Globe className="size-3.5 mr-1.5" />
                Direct URL
              </TabsTrigger>
              <TabsTrigger
                value="search"
                className="inline-flex items-center h-9 justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]: hover:text-foreground"
              >
                <Search className="size-3.5 mr-1.5" />
                Search
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Input field */}
          <div className="relative flex-1 flex items-center gap-2">
            {inputMode === 'search' ? (
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground z-10 pointer-events-none" />
                <Input
                  ref={inputRef}
                  id="kw"
                  autoComplete="off"
                  placeholder='Search for websites, e.g. "Who is the best player in the world?"'
                  value={query}
                  disabled={disabled}
                  className="pl-9 h-11 pr-22  bg-white"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => {
                    setShowDropdown(true);
                    void warmCrawler();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setShowDropdown(false);
                      runSearch();
                    }
                  }}
                />
                {showDropdown && cachedQueries.length > 0 && (
                  <div
                    ref={dropdownRef}
                    className="absolute z-10 top-full left-0 mt-1 w-full rounded-md border border-border bg-popover  overflow-hidden"
                  >
                    <div className="py-1">
                      {cachedQueries.map((cq) => (
                        <div
                          key={cq}
                          className="flex items-center justify-between px-3 py-1.5 text-sm hover:bg-muted cursor-pointer group"
                          onClick={() => {
                            setQuery(cq);
                            setShowDropdown(false);
                          }}
                        >
                          <div className="flex items-center gap-2 truncate mr-2">
                            <Clock className="size-3 text-muted-foreground shrink-0" />
                            <span className="truncate text-xs">{cq}</span>
                          </div>
                          <button
                            className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                            onClick={(e) => removeQuery(cq, e)}
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="relative flex-1 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground z-10 pointer-events-none" />
                      <Input
                        placeholder="Paste URLs (comma or space separated)"
                        value={manualUrl}
                        disabled={disabled}
                        className="pl-9 h-11 pr-16 bg-white"
                        onChange={(e) => setManualUrl(e.target.value)}
                        onFocus={() => void warmCrawler()}
                        onKeyDown={(e) => e.key === 'Enter' && appendManualUrl()}
                      />
                    </div>
                    <Button
                      size="icon"
                      className="h-11 w-11 shrink-0"
                      variant="outline"
                      onClick={() => appendManualUrl()}
                      disabled={disabled || !manualUrl.trim()}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* No provider configured hint */}
      {firecrawlConfigured === false && !activeProvider && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong className="text-foreground">No search provider configured.</strong> Set up
            Firecrawl (recommended) for search and scraping, or configure a Web Search provider in
            Settings.
          </span>
        </div>
      )}

      {/* Minimal Action Row */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAdvanced ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronsDown className="size-3.5" />
            )}
            {showAdvanced ? 'Hide advanced settings' : 'Advanced settings'}
          </button>
        </div>

        {/* Estimation inline */}
        {selectedUrls.length > 0 && (
          <span className="text-xs text-muted-foreground flex items-center gap-1.5 ml-auto">
            <Clock className="size-3" />
            {specificUrls
              ? `${selectedUrls.length} URL${selectedUrls.length !== 1 ? 's' : ''}`
              : `~${estimate.totalPages.toLocaleString()} pages · ${formatDuration(
                  estimate.estimatedSeconds,
                )}`}
          </span>
        )}
      </div>

      {/* Advanced Settings Collapsible */}
      {showAdvanced && (
        <div className="flex flex-col gap-4 w-full rounded-lg border border-border bg-muted/30 p-3 mt-2 animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex ">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Scope</Label>
                <Select
                  defaultValue={scope}
                  value={scope}
                  onValueChange={(v) => setScope(v as CrawlScope)}
                  disabled={specificUrls || disabled}
                >
                  <SelectTrigger className="w-52 bg-white h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="page">Scrape pages only</SelectItem>
                    <SelectItem value="domain">Crawl whole domain</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {scope === 'domain' && !specificUrls && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="limit" className="text-xs text-muted-foreground ml-4">
                    Max pages
                  </Label>
                  <Input
                    id="limit"
                    type="number"
                    min={1}
                    max={500}
                    value={pageLimit}
                    disabled={specificUrls || disabled}
                    onChange={(e) => setPageLimit(Number(e.target.value) || 1)}
                    className="w-20 h-8 tabular-nums text-xs ml-2"
                  />
                </div>
              )}

              {inputMode === 'search' && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="search-limit" className="text-xs text-muted-foreground ml-4">
                    Max results
                  </Label>
                  <Input
                    id="search-limit"
                    type="number"
                    min={1}
                    max={100}
                    value={searchLimit}
                    disabled={disabled}
                    onChange={(e) => setSearchLimit(Number(e.target.value) || 1)}
                    className="w-20 h-8 tabular-nums text-xs ml-2"
                  />
                </div>
              )}

              <div className="flex items-center gap-2 ml-4">
                <Switch
                  id="specific-urls-inline"
                  checked={specificUrls}
                  onCheckedChange={setSpecificUrls}
                  disabled={disabled}
                  size="sm"
                />
                <Label
                  htmlFor="specific-urls-inline"
                  className="text-xs font-medium cursor-pointer flex items-center gap-1"
                >
                  Exact URLs only
                  <TooltipProvider delay={0}>
                    <Tooltip>
                      <TooltipTrigger
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={(e) => e.preventDefault()}
                      >
                        <Info className="size-3" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-50 text-center">
                          Scrape exact URLs only — no deep crawl or pagination.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </Label>
              </div>
            </div>
            <TooltipProvider delay={0}>
              <Tooltip>
                <TooltipTrigger
                  type="button"
                  className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors"
                  onClick={() => router.push('/settings?section=search-web')}
                >
                  <Settings className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  <p>
                    Customize your web search provider, or set up a custom proxy to help bypass
                    scraping blocks.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      )}

      {manualUrlList.length > 0 && inputMode === 'url' && (
        <div className="rounded-md border border-border bg-card overflow-hidden mt-2 animate-in slide-in-from-top-2 fade-in duration-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="py-2 pl-3 text-left font-medium text-muted-foreground">URL</th>
                <th className="py-2 pr-3 text-right font-medium text-muted-foreground w-12">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {currentManualUrls.map((url) => (
                <tr
                  key={url}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="py-2 pl-3">
                    <span className="truncate max-w-100 inline-block">{url}</span>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <button
                      type="button"
                      onClick={() => setManualUrlList((prev) => prev.filter((u) => u !== url))}
                      className="text-muted-foreground hover:text-destructive transition-colors rounded p-1"
                      title="Remove URL"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalManualPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground bg-muted/20">
              <span>
                {(manualUrlPage - 1) * MANUAL_URL_PAGE_SIZE + 1}–
                {Math.min(manualUrlPage * MANUAL_URL_PAGE_SIZE, manualUrlList.length)} of{' '}
                {manualUrlList.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  disabled={manualUrlPage === 1}
                  onClick={() => setManualUrlPage((p) => Math.max(1, p - 1))}
                  className="rounded p-1 hover:bg-muted disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span className="tabular-nums font-medium mx-1">
                  {manualUrlPage} / {totalManualPages}
                </span>
                <button
                  disabled={manualUrlPage >= totalManualPages}
                  onClick={() => setManualUrlPage((p) => Math.min(totalManualPages, p + 1))}
                  className="rounded p-1 hover:bg-muted disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results list */}
      {results.length > 0 && (
        <div className="rounded-lg border border-border mb-9">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {results.length} source{results.length === 1 ? '' : 's'} · {selectedUrls.length}{' '}
              selected
            </span>
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => {
                  const all = selectedUrls.length !== results.length;
                  setSelected(all ? Object.fromEntries(results.map((r) => [r.url, true])) : {});
                }}
              >
                {selectedUrls.length === results.length ? 'Deselect all' : 'Select all'}
              </button>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-destructive hover:underline"
                onClick={flushSearch}
              >
                <Trash2 className="size-3.5" />
                Clear
              </button>
            </div>
          </div>
          <ul className="divide-y divide-border overflow-y-auto">
            {currentDisplayResults.map((r) => {
              const checked = !!selected[r.url];
              return (
                <li key={r.url}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50',
                      'bg-white',
                      checked && 'bg-accent/50',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [r.url]: !!v }))}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.title}</span>
                      <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <Globe className="size-3 shrink-0" />
                        {domainOf(r.url)}
                      </span>
                      {r.description && (
                        <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground/80">
                          {r.description}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {/* Local Pagination footer */}
          {results.length > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-between border-t border-border px-3 py-2 bg-muted/20">
              <span className="text-xs text-muted-foreground">
                Showing {(displayPage - 1) * ITEMS_PER_PAGE + 1} to{' '}
                {Math.min(displayPage * ITEMS_PER_PAGE, results.length)} of {results.length} sources
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={displayPage === 1}
                  onClick={() => setDisplayPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <div className="flex items-center gap-2 px-2 text-xs font-medium">
                  {displayPage} / {totalDisplayPages}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={displayPage === totalDisplayPages}
                  onClick={() => setDisplayPage((p) => Math.min(totalDisplayPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* API Pagination footer */}
          {searchState?.searchProvider === 'serper' &&
            (searchState.hasMore || loadingMore || gatheringAll) && (
              <div className="flex items-center justify-between border-t border-border px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  {gatheringAll
                    ? `Gathering page ${gatherProgress} of ${searchState.totalPages}…`
                    : `Page ${searchState.currentPage} of ${searchState.totalPages}`}
                </span>
                <div className="flex items-center gap-2">
                  {gatherAllAvailable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-xs"
                      onClick={gatherAll}
                    >
                      <ChevronsDown className="size-3.5" />
                      Gather all ({searchState.totalPages - searchState.currentPage} more pages)
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={loadNextPage}
                    disabled={!searchState?.hasMore || loadingMore || gatheringAll}
                  >
                    {loadingMore ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                    Load next page
                  </Button>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
