import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG } from '../../../packages/core/src/types';
import { writeConfig } from '../../../packages/core/src/config-store';
import {
  readLocalState,
  startNativeLocal,
  stopLocal,
} from '../../../packages/scraper/src/local-runtime';
import { isFirecrawlConfigured, searchWeb } from '../../../packages/scraper/src/firecrawl';
import { isBlockedPage } from '../../../packages/scraper/src/job-runner';
import {
  getNativeCrawlStatus,
  startNativeCrawl,
  nativeScrapePage,
} from '../../../packages/scraper/src/native-crawler';

const originalDataDir = process.env.LARKUP_DATA_DIR;
let testDataDir: string | undefined;

test.beforeEach(async () => {
  testDataDir = await mkdtemp(path.join(tmpdir(), 'larkup-native-crawler-config-'));
  process.env.LARKUP_DATA_DIR = testDataDir;
});

test.afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.LARKUP_DATA_DIR;
  else process.env.LARKUP_DATA_DIR = originalDataDir;
  if (testDataDir) await rm(testDataDir, { recursive: true, force: true });
  testDataDir = undefined;
});

test('the built-in crawler remains available as a Docker-free fallback', async () => {
  const originalCwd = process.cwd();
  const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-native-crawler-'));
  try {
    process.chdir(workspace);
    const state = await startNativeLocal();

    expect(state.running).toBe(true);
    expect(state.mode).toBe('native');
    expect(state.endpoint).toBe('native://larkup-crawler');
    await expect(isFirecrawlConfigured()).resolves.toBe(true);

    await stopLocal();
    await expect(readLocalState()).resolves.toMatchObject({ running: false, mode: 'native' });
  } finally {
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('native crawler search returns public result URLs without Docker or an API key', async () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-native-search-'));
  try {
    process.chdir(workspace);
    globalThis.fetch = (async () =>
      new Response(
        '<a href="https://example.com/result" class="search-link l1"><div class="title" title="Example result">Example result</div></a>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      )) as typeof fetch;

    await expect(searchWeb('example query', 5)).resolves.toEqual([
      { url: 'https://example.com/result', title: 'Example result' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('native crawler sends local scrape traffic through the saved proxy', async () => {
  const originalCwd = process.cwd();
  const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-native-proxy-'));
  const target = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><title>Proxied page</title><body>Readable proxied content</body></html>');
  });
  const proxy = createServer();
  let proxyAuthorization: string | undefined;

  try {
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const targetPort = (target.address() as net.AddressInfo).port;
    proxy.on('connect', (request, socket, head) => {
      proxyAuthorization = request.headers['proxy-authorization'];
      const [host, port] = request.url!.split(':');
      const upstream = net.connect(Number(port), host, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on('error', () => socket.destroy());
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const proxyPort = (proxy.address() as net.AddressInfo).port;

    process.chdir(workspace);
    await writeConfig({
      ...DEFAULT_CONFIG,
      useScraperProxy: true,
      scraperProxyServer: `http://127.0.0.1:${proxyPort}`,
      scraperProxyUsername: 'proxy-user',
      scraperProxyPassword: 'proxy-password',
    });

    await expect(
      nativeScrapePage(`http://127.0.0.1:${targetPort}/internship-program`),
    ).resolves.toMatchObject({
      title: 'Proxied page',
      markdown: 'Proxied page Readable proxied content',
    });
    expect(proxyAuthorization).toBe(
      `Basic ${Buffer.from('proxy-user:proxy-password').toString('base64')}`,
    );
  } finally {
    process.chdir(originalCwd);
    proxy.closeAllConnections();
    target.closeAllConnections();
    proxy.close();
    target.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Anubis proof-of-work pages are not accepted as website content', () => {
  expect(
    isBlockedPage(`
      Making sure you're not a bot!
      Anubis could not load its JavaScript. The server may be overloaded.
      Protected by Anubis From Techaro.
    `),
  ).toBe(true);
});

test('native domain crawl reports an inaccessible site instead of completing empty', async () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-native-crawl-error-'));
  try {
    process.chdir(workspace);
    globalThis.fetch = (async () => {
      throw new Error('Network connection failed');
    }) as typeof fetch;

    const crawl = await startNativeCrawl('https://example.com', 1);
    await expect(getNativeCrawlStatus(crawl)).resolves.toMatchObject({
      state: 'failed',
      completed: 0,
      error: 'Network connection failed',
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('native crawler search falls back when its primary public source is rate-limited', async () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-native-search-fallback-'));
  try {
    process.chdir(workspace);
    await startNativeLocal();
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount++;
      if (requestCount === 1) return new Response('', { status: 429 });
      return new Response(
        '<rss><channel><item><title>Fallback result</title><link>https://example.com/fallback</link><description>Fallback description</description></item></channel></rss>',
        { status: 200, headers: { 'content-type': 'application/rss+xml' } },
      );
    }) as typeof fetch;

    await expect(searchWeb('example query', 5)).resolves.toEqual([
      {
        url: 'https://example.com/fallback',
        title: 'Fallback result',
        description: 'Fallback description',
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('native crawls keep independent state when several jobs start together', async () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-native-crawl-state-'));
  try {
    process.chdir(workspace);
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(`<html><title>${url}</title><body>Readable page</body></html>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as typeof fetch;

    const [first, second] = await Promise.all([
      startNativeCrawl('https://example.com/one', 1),
      startNativeCrawl('https://example.org/two', 1),
    ]);
    await expect(getNativeCrawlStatus(first)).resolves.toMatchObject({
      state: 'completed',
      completed: 1,
    });
    await expect(getNativeCrawlStatus(second)).resolves.toMatchObject({
      state: 'completed',
      completed: 1,
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});
