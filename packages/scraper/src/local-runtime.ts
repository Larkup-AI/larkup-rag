import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readConfig } from '@larkup/core/config-store';

/**
 * Manages the local crawler runtime.
 *
 * Self-hosted Firecrawl runs with DB auth disabled, so no real API key is
 * required — any bearer token is accepted. We still generate one automatically
 * ("get its key automatically") and wire both the endpoint and token into the
 * toolkit so web scraping works against localhost without the user touching
 * env vars.
 *
 * Regular installations use Larkup's built-in HTTP crawler and never require
 * Docker. Docker remains an optional Firecrawl sibling for container installs.
 */

const execAsync = promisify(exec);

async function runCmd(cmd: string, timeout?: number) {
  const env = {
    ...process.env,
    PATH: `${process.env.PATH || ''}:/usr/local/bin:/opt/homebrew/bin:/bin:/usr/bin`,
  };
  return execAsync(cmd, { timeout, env });
}

const DATA_DIR = path.join(process.cwd(), '.larkup');
const STATE_PATH = path.join(DATA_DIR, 'firecrawl-local.json');
const COMPOSE_PATH = path.join(DATA_DIR, 'firecrawl', 'docker-compose.yml');

const CONTAINER_PREFIX = 'ragtoolkit-firecrawl';
const DEFAULT_PORT = 3002;
const IMAGE = 'ghcr.io/firecrawl/firecrawl:latest';

async function getFreePort(startingPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startingPort, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        getFreePort(startingPort === 0 ? 0 : startingPort + 1).then(resolve, reject);
      } else {
        reject(err);
      }
    });
  });
}

async function getProxy(): Promise<{
  server: string;
  username?: string;
  password?: string;
} | null> {
  // Settings are the explicit user choice and must take precedence over an
  // optional legacy proxies.txt pool.
  const config = await readConfig();
  if (config.useScraperProxy && config.scraperProxyServer) {
    return {
      server: config.scraperProxyServer,
      username: config.scraperProxyUsername,
      password: config.scraperProxyPassword,
    };
  }

  // A proxies.txt pool remains a compatibility fallback for scripted Docker
  // deployments; choose one line per launch to avoid session stickiness.
  try {
    const proxiesPath = path.join(process.cwd(), 'proxies.txt');
    const raw = await fs.readFile(proxiesPath, 'utf8');
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length > 0) {
      const randomLine = lines[Math.floor(Math.random() * lines.length)];
      const parts = randomLine.split(':');

      if (parts.length >= 4) {
        return {
          server: `http://${parts[0]}:${parts[1]}`,
          username: parts[2],
          password: parts[3],
        };
      }
    }
  } catch (err) {}

  return null;
}

function proxyFingerprint(proxy: Awaited<ReturnType<typeof getProxy>>): string {
  return createHash('sha256')
    .update(
      proxy ? `${proxy.server}\u0000${proxy.username ?? ''}\u0000${proxy.password ?? ''}` : '',
    )
    .digest('hex');
}

async function configuredProxyFingerprint(): Promise<string> {
  const config = await readConfig();
  if (!config.useScraperProxy || !config.scraperProxyServer) return proxyFingerprint(null);
  return proxyFingerprint({
    server: config.scraperProxyServer,
    username: config.scraperProxyUsername,
    password: config.scraperProxyPassword,
  });
}

export interface LocalFirecrawlState {
  running: boolean;
  endpoint: string;
  apiKey: string;
  port: number;
  /** docker compose project name */
  project: string;
  /** `native` is the dependency-free crawler shipped with Larkup. */
  mode?: 'native' | 'firecrawl';
  /** Hash of the proxy configuration applied to the browser containers. */
  proxyFingerprint?: string;
  startedAt?: string;
  lastError?: string;
}

const EMPTY: LocalFirecrawlState = {
  running: false,
  endpoint: `http://localhost:${DEFAULT_PORT}`,
  apiKey: '',
  port: DEFAULT_PORT,
  project: CONTAINER_PREFIX,
  mode: 'native',
};

let localStartPromise: Promise<LocalFirecrawlState> | undefined;

function nativeState(startedAt?: string): LocalFirecrawlState {
  return {
    running: true,
    endpoint: 'native://larkup-crawler',
    apiKey: 'native',
    port: 0,
    project: 'native',
    mode: 'native',
    startedAt: startedAt || new Date().toISOString(),
    lastError: undefined,
  };
}

export async function readLocalState(): Promise<LocalFirecrawlState> {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<LocalFirecrawlState>) };
  } catch {
    return EMPTY;
  }
}

async function writeState(state: LocalFirecrawlState) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

/** Resolve `docker compose` (v2) vs legacy `docker-compose`, or null if absent. */
async function resolveDocker(): Promise<{
  docker: boolean;
  compose: string | null;
}> {
  try {
    await runCmd('docker --version');
  } catch {
    // Docker not installed — expected for non-Docker (curl) installs.
    return { docker: false, compose: null };
  }
  try {
    await runCmd('docker compose version');
    return { docker: true, compose: 'docker compose' };
  } catch {
    // fall through — try legacy docker-compose
  }
  try {
    await runCmd('docker-compose version');
    return { docker: true, compose: 'docker-compose' };
  } catch {
    return { docker: true, compose: null };
  }
}

export interface DockerAvailability {
  docker: boolean;
  compose: boolean;
  message: string;
}

export async function checkDocker(): Promise<DockerAvailability> {
  const { docker, compose } = await resolveDocker();
  if (!docker) {
    return {
      docker: false,
      compose: false,
      message:
        "Docker isn't available on this machine. Install Docker Desktop (or the Docker engine) and make sure it's running.",
    };
  }
  if (!compose) {
    return {
      docker: true,
      compose: false,
      message:
        'Docker is installed but the Compose plugin was not found. Install `docker compose` to launch Firecrawl locally.',
    };
  }
  return { docker: true, compose: true, message: 'Docker is ready.' };
}

/**
 * Compose topology for a minimal self-hosted Firecrawl:
 * redis + the API + the headless Playwright scraping service.
 */
function composeFile(
  apiKey: string,
  port: number,
  proxy: { server: string; username?: string; password?: string } | null,
) {
  const proxyEnvLines = proxy
    ? [
        `PROXY_SERVER: "${proxy.server}"`,
        ...(proxy.username && proxy.password
          ? [`PROXY_USERNAME: "${proxy.username}"`, `PROXY_PASSWORD: "${proxy.password}"`]
          : []),
      ]
    : [];

  const pwEnv = ['PORT: "3000"', ...proxyEnvLines].map((l) => `      ${l}`).join('\n');
  const apiEnv = [
    `PORT: "3002"`,
    ...proxyEnvLines,
    `HOST: "0.0.0.0"`,
    `REDIS_URL: "redis://redis:6379"`,
    `REDIS_RATE_LIMIT_URL: "redis://redis:6379"`,
    `PLAYWRIGHT_MICROSERVICE_URL: "http://playwright-service:3000/scrape"`,
    `USE_DB_AUTHENTICATION: "false"`,
    `TEST_API_KEY: "${apiKey}"`,
    `BULL_AUTH_KEY: "${apiKey}"`,
    `DATABASE_URL: "postgresql://user:password@db:5432/postgres"`,
    `NUQ_DATABASE_URL: "postgresql://user:password@db:5432/postgres"`,
    `NUQ_RABBITMQ_URL: "amqp://user:password@rabbitmq:5672"`,
  ]
    .map((l) => `      ${l}`)
    .join('\n');

  return `# Auto-generated by RAG Toolkit. Do not edit by hand.
services:
  db:
    image: ghcr.io/firecrawl/nuq-postgres:latest
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: postgres
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d postgres"]
      interval: 5s
      timeout: 5s
      retries: 12
    restart: unless-stopped

  rabbitmq:
    image: rabbitmq:3-management-alpine
    environment:
      RABBITMQ_DEFAULT_USER: user
      RABBITMQ_DEFAULT_PASS: password
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "check_running"]
      interval: 5s
      timeout: 5s
      retries: 3
      start_period: 5s
    restart: unless-stopped

  redis:
    image: redis:alpine
    command: redis-server --save "" --appendonly no
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 12
    restart: unless-stopped

  playwright-service:
    image: ghcr.io/firecrawl/playwright-service:latest
    environment:
${pwEnv}
    restart: unless-stopped

  api:
    image: ${IMAGE}
    depends_on:
      db:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "${port}:3002"
    environment:
${apiEnv}
    restart: unless-stopped
`;
}

/** Launch (or re-attach to) a local Firecrawl via docker compose. */
export async function startLocal(): Promise<LocalFirecrawlState> {
  // Use Firecrawl's Playwright service whenever Docker is available. The
  // native crawler remains a zero-setup fallback, but it cannot execute the
  // JavaScript challenges used by sites such as Anubis.
  const avail = await checkDocker();
  if (!avail.compose) {
    return writeState(nativeState());
  }

  const { compose } = await resolveDocker();
  const prev = await readLocalState();
  const apiKey = prev.apiKey || `fc-local-${randomUUID()}`;
  let port = prev.port || DEFAULT_PORT;

  const proxy = await getProxy();
  const currentProxyFingerprint = await configuredProxyFingerprint();

  await fs.mkdir(path.dirname(COMPOSE_PATH), { recursive: true });
  await fs.writeFile(COMPOSE_PATH, composeFile(apiKey, port, proxy), 'utf8');

  try {
    await runCmd(`${compose} -p ${CONTAINER_PREFIX} -f "${COMPOSE_PATH}" up -d`, 180_000);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'docker compose failed';

    if (message.includes('address already in use') || message.includes('Ports are not available')) {
      try {
        port = await getFreePort(port + 1);
        await fs.writeFile(COMPOSE_PATH, composeFile(apiKey, port, proxy), 'utf8');
        await runCmd(`${compose} -p ${CONTAINER_PREFIX} -f "${COMPOSE_PATH}" up -d`, 180_000);
      } catch (retryErr) {
        return writeState({
          ...nativeState(),
          lastError:
            'The browser crawler could not start, so the basic crawler is being used instead.',
        });
      }
    } else {
      return writeState({
        ...nativeState(),
        lastError:
          'The browser crawler could not start, so the basic crawler is being used instead.',
      });
    }
  }

  const isDockerContainer = existsSync('/.dockerenv');
  const host = isDockerContainer ? 'host.docker.internal' : 'localhost';
  const endpoint = `http://${host}:${port}`;
  const healthy = await waitForHealth(endpoint, 90_000);

  if (!healthy) {
    return writeState({
      ...nativeState(),
      lastError:
        'The browser crawler took too long to start, so the basic crawler is being used instead.',
    });
  }

  return writeState({
    running: true,
    endpoint,
    apiKey,
    port,
    project: CONTAINER_PREFIX,
    mode: 'firecrawl',
    proxyFingerprint: currentProxyFingerprint,
    startedAt: new Date().toISOString(),
  });
}

/**
 * Start the browser crawler without making an API request wait for image pulls
 * or browser boot. Callers can poll `isLocalStartInProgress` and the state.
 */
export async function startLocalInBackground(): Promise<{
  state: LocalFirecrawlState;
  starting: boolean;
}> {
  const state = await readLocalState();
  const currentProxyFingerprint = await configuredProxyFingerprint();
  if (
    state.running &&
    state.mode === 'firecrawl' &&
    state.proxyFingerprint === currentProxyFingerprint
  ) {
    return { state, starting: false };
  }

  if (!localStartPromise) {
    localStartPromise = startLocal()
      .catch(() =>
        writeState({
          ...nativeState(),
          lastError:
            'The browser crawler could not start, so the basic crawler is being used instead.',
        }),
      )
      .finally(() => {
        localStartPromise = undefined;
      });
  }

  return { state, starting: true };
}

export function isLocalStartInProgress(): boolean {
  return Boolean(localStartPromise);
}

/**
 * The dependency-free crawler is always available in the Larkup process,
 * including when Larkup itself runs in Docker. This is the no-setup fallback
 * when a Docker deployment does not include the optional Firecrawl profile.
 */
export async function startNativeLocal(): Promise<LocalFirecrawlState> {
  return writeState(nativeState());
}

/** Stop and remove the local Firecrawl containers. */
export async function stopLocal(): Promise<LocalFirecrawlState> {
  const prev = await readLocalState();
  if (prev.mode === 'native') {
    return writeState({ ...prev, running: false, startedAt: undefined });
  }
  const { compose } = await resolveDocker();
  if (compose) {
    try {
      await runCmd(`${compose} -p ${CONTAINER_PREFIX} -f "${COMPOSE_PATH}" down`, 60_000);
    } catch {
      // best-effort
    }
  }
  return writeState({ ...prev, running: false, startedAt: undefined });
}

/** Re-check whether the local instance is actually responding. */
export async function refreshLocalStatus(): Promise<LocalFirecrawlState> {
  const state = await readLocalState();
  if (state.mode === 'native' || !state.startedAt) return state;
  const healthy = await isHealthy(state.endpoint);
  if (healthy !== state.running) {
    return writeState({
      ...state,
      running: healthy,
      lastError: healthy ? undefined : 'The browser crawler is not responding.',
    });
  }
  return state;
}

async function isHealthy(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitForHealth(endpoint: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(endpoint)) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/** Whether Larkup is itself running inside a Docker container. */
export function isInsideDocker(): boolean {
  return (
    process.env.DOCKER_ENV === 'true' ||
    process.env.DOCKER_BUILD === '1' ||
    existsSync('/.dockerenv')
  );
}

/**
 * When Larkup runs in Docker, Firecrawl may be a sibling service on the same
 * Docker network (started via `--profile crawler`). This checks whether the
 * sibling API is reachable and wires it up automatically.
 *
 * Docker Compose DNS resolves "firecrawl-api" to the sibling container.
 */
const DOCKER_SIBLING_ENDPOINT = 'http://firecrawl-api:3002';

export async function checkDockerSibling(): Promise<{
  available: boolean;
  endpoint: string;
}> {
  if (!isInsideDocker()) {
    return { available: false, endpoint: '' };
  }
  const up = await isHealthy(DOCKER_SIBLING_ENDPOINT);
  return { available: up, endpoint: DOCKER_SIBLING_ENDPOINT };
}

/**
 * Wire a discovered Docker-sibling Firecrawl into the local state so the
 * scraper client talks to it automatically.
 */
export async function connectDockerSibling(): Promise<LocalFirecrawlState> {
  const { available } = await checkDockerSibling();
  if (!available) {
    return writeState({
      ...EMPTY,
      running: false,
      lastError: 'The web crawler service is not available in this Docker deployment.',
    });
  }
  const apiKey = `fc-docker-${randomUUID()}`;
  return writeState({
    running: true,
    endpoint: DOCKER_SIBLING_ENDPOINT,
    apiKey,
    port: DEFAULT_PORT,
    project: 'docker-sibling',
    mode: 'firecrawl',
    startedAt: new Date().toISOString(),
  });
}
