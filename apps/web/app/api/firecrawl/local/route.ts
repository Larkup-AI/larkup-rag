import { NextResponse } from 'next/server';
import {
  checkDocker,
  refreshLocalStatus,
  startLocalInBackground,
  startNativeLocal,
  stopLocal,
  isLocalStartInProgress,
  isInsideDocker,
  checkDockerSibling,
  connectDockerSibling,
} from '@larkup/scraper/local-runtime';
import { getRuntimeEnv } from '@/lib/runtime/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → current local instance state + docker availability + runtime env. */
export async function GET() {
  const runtimeEnv = getRuntimeEnv();

  if (runtimeEnv === 'docker') {
    const [state, sibling] = await Promise.all([refreshLocalStatus(), checkDockerSibling()]);
    const { apiKey, ...safe } = state;
    return NextResponse.json({
      state: {
        ...safe,
        hasKey: Boolean(apiKey),
        // If the sibling is up, update running state
        running: state.running || sibling.available,
        endpoint: sibling.available ? sibling.endpoint : safe.endpoint,
      },
      docker: {
        docker: true,
        compose: sibling.available,
        message: sibling.available
          ? 'Crawler service is running.'
          : 'Crawler service is not available for this Docker installation.',
      },
      runtimeEnv,
    });
  }

  // Desktop or web — check Docker CLI availability
  const [state, docker] = await Promise.all([refreshLocalStatus(), checkDocker()]);
  const { apiKey, ...safe } = state;
  return NextResponse.json({
    state: { ...safe, hasKey: Boolean(apiKey) },
    docker,
    runtimeEnv,
    starting: isLocalStartInProgress(),
  });
}

/** POST { action: "start" | "stop" } → control the local Firecrawl container. */
export async function POST(req: Request) {
  const runtimeEnv = getRuntimeEnv();

  let action: string | undefined;
  try {
    ({ action } = (await req.json()) as { action?: string });
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (action !== 'start' && action !== 'stop') {
    return NextResponse.json({ error: 'action must be "start" or "stop".' }, { status: 400 });
  }

  if (runtimeEnv === 'docker') {
    if (action === 'start') {
      // A `docker run` container cannot create sibling containers. Attach to
      // an optional Firecrawl sibling when present, otherwise use the built-in
      // crawler that runs in this Larkup process.
      const sibling = await checkDockerSibling();
      const state = sibling.available ? await connectDockerSibling() : await startNativeLocal();
      const { apiKey, ...safe } = state;
      return NextResponse.json({ state: { ...safe, hasKey: Boolean(apiKey) } });
    } else {
      const state = await stopLocal();
      const { apiKey, ...safe } = state;
      return NextResponse.json({
        state: { ...safe, hasKey: Boolean(apiKey) },
      });
    }
  }

  // Starting Chromium can involve a first-time image pull. Respond right away
  // and let the UI poll the explicit crawler status instead of leaving users
  // stuck on an indefinite loading toast.
  if (action === 'start') {
    const { state, starting } = await startLocalInBackground();
    const { apiKey, ...safe } = state;
    return NextResponse.json({ state: { ...safe, hasKey: Boolean(apiKey) }, starting });
  }

  const state = await stopLocal();
  const { apiKey, ...safe } = state;
  return NextResponse.json({ state: { ...safe, hasKey: Boolean(apiKey) } });
}
