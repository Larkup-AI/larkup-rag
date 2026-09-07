'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type CrawlerResponse = {
  state: { running: boolean; mode?: 'native' | 'firecrawl' };
  starting?: boolean;
};

type Status = 'starting' | 'ready' | 'unavailable';

/** Compact, non-technical browser readiness indicator for the Website tab. */
export function WebCrawlerStatus() {
  const [status, setStatus] = useState<Status>('starting');

  async function updateStatus(start = false) {
    try {
      const res = await fetch(
        '/api/firecrawl/local',
        start
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'start' }),
            }
          : { cache: 'no-store' },
      );
      const body = (await res.json()) as CrawlerResponse;
      if (!res.ok) throw new Error('Crawler status failed');
      if (body.state.running && body.state.mode === 'firecrawl') setStatus('ready');
      else if (body.starting) setStatus('starting');
      else setStatus('unavailable');
    } catch {
      setStatus('unavailable');
    }
  }

  useEffect(() => {
    void updateStatus(true);
    const interval = window.setInterval(() => void updateStatus(), 2_000);
    return () => window.clearInterval(interval);
  }, []);

  const label =
    status === 'ready'
      ? 'Web browser is ready to scrape websites.'
      : status === 'starting'
        ? 'Launching web browser…'
        : 'Web browser is unavailable. Basic website reading is active for now.';

  return (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Web browser status"
              className="relative flex size-7 items-center justify-center rounded-md outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => void updateStatus(true)}
            >
              <span
                className={cn(
                  'relative block size-2 rounded-full',
                  status === 'ready'
                    ? 'bg-emerald-500'
                    : status === 'starting'
                      ? 'bg-blue-500'
                      : 'bg-red-500',
                )}
              >
                {status === 'starting' && (
                  <span className="absolute inset-0 animate-ping rounded-full bg-blue-400/80" />
                )}
              </span>
            </button>
          }
        />
        <TooltipContent className="max-w-60 text-xs">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
