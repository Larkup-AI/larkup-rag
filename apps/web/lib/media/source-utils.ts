import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { chmodSync, createWriteStream, promises as fs } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import bundledFfprobe from '@ffprobe-installer/ffprobe';

export type RemoteMediaType = 'audio' | 'video' | 'unknown';

export interface ImportedMedia {
  path: string;
  originalUrl: string;
  title: string;
  mimeType?: string;
  mediaType: RemoteMediaType;
  sourceTranscript?: {
    chunks: Array<{ text: string; startSecs: number; endSecs: number }>;
    language?: string;
  };
}

export interface UrlInspection {
  originalUrl: string;
  title?: string;
  mimeType?: string;
  mediaType: RemoteMediaType;
  contentLength?: number;
  durationSecs?: number;
  singleItemDurationSecs?: number;
  singleItemUrl?: string;
  entryCount?: number;
  isYouTube: boolean;
}

/** Checking a pasted non-YouTube URL must stay interactive, not block on a slow origin. */
export const MEDIA_URL_INSPECTION_TIMEOUT_MS = 7_000;

interface YouTubeInspectionData {
  title?: string;
  duration?: number;
  entries?: Array<{
    id?: string;
    url?: string;
    webpage_url?: string;
    duration?: number;
  }>;
}

function positiveDuration(value: unknown): number | undefined {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

function youtubeVideoId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.hostname === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0];
    return parsed.searchParams.get('v') ?? undefined;
  } catch {
    return /^[\w-]{6,}$/.test(value) ? value : undefined;
  }
}

export function inspectYouTubeMetadata(url: string, data: YouTubeInspectionData): UrlInspection {
  const entries = data.entries ?? [];
  const requestedId = youtubeVideoId(url);
  const selectedEntry =
    entries.find(
      (entry) =>
        requestedId &&
        [entry.id, youtubeVideoId(entry.url), youtubeVideoId(entry.webpage_url)].includes(
          requestedId,
        ),
    ) ?? entries[0];
  const selectedId =
    selectedEntry?.id ??
    youtubeVideoId(selectedEntry?.webpage_url) ??
    youtubeVideoId(selectedEntry?.url) ??
    requestedId;
  const playlistDuration = entries.reduce(
    (total, entry) => total + (positiveDuration(entry.duration) ?? 0),
    0,
  );
  const durationSecs = positiveDuration(data.duration) ?? (playlistDuration || undefined);
  const singleItemDurationSecs =
    positiveDuration(selectedEntry?.duration) ?? (entries.length <= 1 ? durationSecs : undefined);

  return {
    originalUrl: url,
    title: data.title,
    durationSecs,
    singleItemDurationSecs,
    singleItemUrl: selectedId
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(selectedId)}`
      : undefined,
    entryCount: Math.max(1, entries.length),
    mediaType: 'video',
    isYouTube: true,
  };
}

export interface MediaProbe {
  durationSecs: number;
  hasCorruptionSignals: boolean;
}

export interface MediaImportProgress {
  percent?: number;
  current?: number;
  total?: number;
  unit?: string;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number;
  message: string;
}

export function createArtifactCacheKey(input: {
  contentHash: string;
  operation: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  schemaVersion?: string;
  configuration?: Record<string, string | number | boolean | undefined>;
}) {
  const configuration = Object.entries(input.configuration ?? {})
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...input,
        configuration,
      }),
    )
    .digest('hex');
}

export function extractRunningState(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(-500);
}

export function deriveAudioSignals(
  chunks: Array<{ text: string; startSecs: number; endSecs: number }>,
  silenceGapSecs = 2,
) {
  const result: Array<{
    timestampSecs: number;
    transcriptChange: number;
    silenceBoundary: boolean;
  }> = [];
  let previous: (typeof chunks)[number] | undefined;
  for (const chunk of [...chunks].sort((left, right) => left.startSecs - right.startSecs)) {
    const previousWords = new Set(
      (previous?.text ?? '').toLocaleLowerCase().match(/[\p{Letter}\p{Number}]+/gu) ?? [],
    );
    const words = new Set(chunk.text.toLocaleLowerCase().match(/[\p{Letter}\p{Number}]+/gu) ?? []);
    const novel = [...words].filter((word) => !previousWords.has(word)).length;
    result.push({
      timestampSecs: chunk.startSecs,
      transcriptChange: words.size === 0 ? 0 : Math.min(1, novel / words.size),
      silenceBoundary: Boolean(previous && chunk.startSecs - previous.endSecs >= silenceGapSecs),
    });
    previous = chunk;
  }
  return result;
}

/**
 * The desktop/CLI process does not necessarily inherit a terminal's PATH.
 * Keep probing self-contained, while allowing managed deployments to override it.
 */
export function ffprobeExecutable() {
  const executable = process.env.LARKUP_FFPROBE_PATH?.trim() || bundledFfprobe.path;
  if (executable === bundledFfprobe.path) {
    try {
      // Ensure the bundled binary is executable (npm global installs might strip +x if not in bin field)
      chmodSync(executable, 0o755);
    } catch {
      // Ignore errors (e.g. read-only filesystem)
    }
  }
  return executable;
}

/** Read local media metadata with a bundled ffprobe binary. */
export async function probeMedia(mediaPath: string): Promise<MediaProbe> {
  const output = await runProcess(ffprobeExecutable(), [
    '-v',
    'error',
    '-show_entries',
    'format=duration:format_tags=probe_score',
    '-of',
    'json',
    mediaPath,
  ]);
  const data = JSON.parse(output) as {
    format?: { duration?: string; tags?: { probe_score?: string } };
  };
  const durationSecs = Number(data.format?.duration ?? 0);
  return {
    durationSecs: Number.isFinite(durationSecs) ? Math.max(0, durationSecs) : 0,
    hasCorruptionSignals: !Number.isFinite(durationSecs) || durationSecs <= 0,
  };
}

export async function inspectMediaUrl(url: string): Promise<UrlInspection> {
  const parsed = validHttpUrl(url);
  if (isYouTube(parsed)) {
    const output = await runYtDlp(['--dump-single-json', '--simulate', '--flat-playlist', url]);
    const inspection = inspectYouTubeMetadata(url, JSON.parse(output) as YouTubeInspectionData);
    if (
      (inspection.entryCount ?? 1) > 1 &&
      !inspection.singleItemDurationSecs &&
      inspection.singleItemUrl
    ) {
      const selectedOutput = await runYtDlp([
        '--dump-single-json',
        '--simulate',
        '--no-playlist',
        inspection.singleItemUrl,
      ]);
      const selected = JSON.parse(selectedOutput) as YouTubeInspectionData;
      inspection.singleItemDurationSecs = positiveDuration(selected.duration);
    }
    return inspection;
  }

  let response = await inspectPublicMediaUrl(url, { method: 'HEAD' });
  if (response.status === 405 || response.status === 501) {
    response = await inspectPublicMediaUrl(url, { headers: { Range: 'bytes=0-0' } });
  }
  if (!response.ok) throw new Error(`Unable to inspect media URL (${response.status}).`);
  const headerMime = response.headers.get('content-type')?.split(';')[0];
  const mimeType =
    mediaTypeFromMime(headerMime) === 'unknown'
      ? mimeFromExtension(path.extname(parsed.pathname).slice(1))
      : headerMime;
  const rangeTotal = response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1];
  await response.body?.cancel();
  return {
    originalUrl: url,
    mimeType,
    mediaType: mediaTypeFromMime(mimeType),
    contentLength: Number(rangeTotal ?? response.headers.get('content-length')) || undefined,
    durationSecs: Number(response.headers.get('content-duration')) || undefined,
    entryCount: 1,
    isYouTube: false,
  };
}

async function inspectPublicMediaUrl(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchPublic(url, {
      ...init,
      signal: AbortSignal.timeout(MEDIA_URL_INSPECTION_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(
        'The media URL did not respond within 7 seconds. Check that it is public and try again.',
      );
    }
    throw error;
  }
}

export async function importMediaUrl(
  url: string,
  options: {
    outputDir: string;
    maxBytes?: number;
    playlistMax?: number;
    onProgress?: (progress: MediaImportProgress) => void;
  },
): Promise<ImportedMedia[]> {
  const parsed = validHttpUrl(url);
  await fs.mkdir(options.outputDir, { recursive: true });
  if (isYouTube(parsed)) {
    const template = path.join(options.outputDir, '%(title).120B [%(id)s].%(ext)s');
    const print =
      '{"path":%(filepath)j,"title":%(title)j,"originalUrl":%(webpage_url)j,"ext":%(ext)j}';
    const output = await runYtDlp(
      [
        '--no-playlist',
        '--playlist-end',
        String(options.playlistMax ?? 10),
        '--socket-timeout',
        '20',
        '--retries',
        '2',
        '--newline',
        '--format',
        'best[height<=360]/bestvideo[height<=360]+bestaudio/best',
        '--merge-output-format',
        'mp4',
        '-o',
        template,
        '--print',
        `after_move:${print}`,
        url,
      ],
      options.onProgress,
    );
    return await Promise.all(
      output
        .split('\n')
        .filter(Boolean)
        .map(async (line) => {
          const item = JSON.parse(line) as {
            path: string;
            title: string;
            originalUrl?: string;
            ext: string;
          };
          // yt-dlp's after_move filepath can occasionally refer to an intermediate
          // format file even though the final media was written under another name.
          // Resolve it against the fresh output directory before handing it to storage.
          const mediaPath = await resolveYtDlpMediaPath(item.path, options.outputDir);
          const mimeType =
            mimeFromExtension(path.extname(mediaPath).slice(1)) ?? mimeFromExtension(item.ext);
          return {
            path: mediaPath,
            title: item.title,
            originalUrl: item.originalUrl || url,
            mimeType,
            mediaType: mediaTypeFromMime(mimeType),
          };
        }),
    );
  }

  const downloadStartedAt = Date.now();
  options.onProgress?.({ message: 'Connecting to the media source…', elapsedSeconds: 0 });
  const connectingHeartbeat = options.onProgress
    ? setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - downloadStartedAt) / 1_000);
        options.onProgress?.({
          message: `Connecting to the media source · ${elapsedSeconds}s`,
          elapsedSeconds,
        });
      }, 1_000)
    : undefined;
  let response: Response;
  try {
    response = await fetchPublic(url);
  } finally {
    if (connectingHeartbeat) clearInterval(connectingHeartbeat);
  }
  if (!response.ok || !response.body)
    throw new Error(`Media download failed (${response.status}).`);
  const maxBytes = options.maxBytes ?? 500 * 1024 * 1024;
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) throw new Error(`Media exceeds download limit of ${maxBytes} bytes.`);
  const rawName = path.basename(new URL(response.url).pathname) || 'download';
  const name = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'download';
  const headerMime = response.headers.get('content-type')?.split(';')[0];
  const mimeType =
    mediaTypeFromMime(headerMime) === 'unknown'
      ? mimeFromExtension(path.extname(name).slice(1))
      : headerMime;
  const outputPath = path.join(options.outputDir, `${randomUUID()}-${name}`);
  let bytes = 0;
  let lastProgressAt = 0;
  const hasKnownTotal = Number.isFinite(declared) && declared > 0;
  const body = Readable.fromWeb(response.body as never);
  body.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > maxBytes)
      body.destroy(new Error(`Media exceeds download limit of ${maxBytes} bytes.`));
    const now = Date.now();
    const finished = hasKnownTotal && bytes >= declared;
    if (!options.onProgress || (now - lastProgressAt < 500 && !finished)) return;
    lastProgressAt = now;
    const elapsedSeconds = Math.max(0, Math.floor((now - downloadStartedAt) / 1_000));
    const bytesPerSecond = bytes / Math.max(1, (now - downloadStartedAt) / 1_000);
    const estimatedRemainingSeconds = hasKnownTotal
      ? Math.max(0, Math.round((declared - bytes) / Math.max(1, bytesPerSecond)))
      : undefined;
    options.onProgress({
      ...(hasKnownTotal
        ? { percent: Math.min(99, (bytes / declared) * 100), total: declared }
        : {}),
      current: bytes,
      unit: 'bytes',
      elapsedSeconds,
      estimatedRemainingSeconds,
      message: [
        `Downloading media · ${formatByteCount(bytes)}${
          hasKnownTotal ? ` / ${formatByteCount(declared)}` : ''
        }`,
        `${formatByteCount(bytesPerSecond)}/s`,
      ].join(' · '),
    });
  });
  try {
    await pipeline(body, createWriteStream(outputPath, { flags: 'wx' }));
  } catch (error) {
    await fs.rm(outputPath, { force: true });
    throw error;
  }
  return [
    {
      path: outputPath,
      originalUrl: url,
      title: name,
      mimeType,
      mediaType: mediaTypeFromMime(mimeType),
    },
  ];
}

/**
 * `after_move:filepath` normally names yt-dlp's final file, but some releases
 * can print a path that no longer exists after a format merge. The import
 * directory is newly created for this one download, so a media file bearing the
 * reported video id is a safe fallback without accepting paths outside it.
 */
export async function resolveYtDlpMediaPath(reportedPath: string, outputDir: string) {
  const root = path.resolve(outputDir);
  const expected = path.resolve(reportedPath);
  if (!isPathWithinDirectory(expected, root)) {
    throw new Error('Video downloader returned a file outside its import directory.');
  }
  try {
    const stat = await fs.stat(expected);
    if (stat.isFile()) return expected;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }

  const videoId = path.basename(reportedPath).match(/\[([\w-]+)\](?:\.[^.]+)?$/)?.[1];
  const candidates = await fs.readdir(root, { withFileTypes: true });
  const availableMedia = candidates
    .filter(
      (candidate) =>
        candidate.isFile() && Boolean(mimeFromExtension(path.extname(candidate.name).slice(1))),
    )
    .map((candidate) => path.join(root, candidate.name))
    .filter((candidate) => isPathWithinDirectory(candidate, root));
  if (!availableMedia.length) {
    throw new Error('Video download completed but did not produce a readable media file.');
  }

  const expectedExtension = path.extname(reportedPath).toLowerCase();
  return availableMedia.sort(
    (left, right) =>
      scoreYtDlpMediaCandidate(right, videoId, expectedExtension) -
      scoreYtDlpMediaCandidate(left, videoId, expectedExtension),
  )[0];
}

function isPathWithinDirectory(candidate: string, directory: string) {
  const relative = path.relative(directory, candidate);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

function scoreYtDlpMediaCandidate(
  candidate: string,
  videoId: string | undefined,
  expectedExtension: string,
) {
  const fileName = path.basename(candidate);
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = mimeFromExtension(extension.slice(1));
  return (
    (videoId && fileName.includes(`[${videoId}]`) ? 100 : 0) +
    (mimeType?.startsWith('video/') ? 20 : 0) +
    (extension === expectedExtension ? 10 : 0)
  );
}

async function runYtDlp(args: string[], onProgress?: (progress: MediaImportProgress) => void) {
  const executable = process.env.LARKUP_YTDLP_PATH?.trim() || managedYtDlpPath();
  const preparationStartedAt = Date.now();
  onProgress?.({ message: 'Preparing the video downloader…', elapsedSeconds: 0 });
  const preparationHeartbeat = onProgress
    ? setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - preparationStartedAt) / 1_000);
        onProgress({
          message: `Preparing the video downloader · ${elapsedSeconds}s`,
          elapsedSeconds,
        });
      }, 1_000)
    : undefined;
  try {
    await ensureYtDlp(executable);
  } finally {
    if (preparationHeartbeat) clearInterval(preparationHeartbeat);
  }
  onProgress?.({ message: 'Connecting to the video source…', elapsedSeconds: 0 });
  return runProcess(executable, ['--js-runtimes', 'nodejs:node', ...args], onProgress);
}

function managedYtDlpPath() {
  return path.join(
    process.cwd(),
    '.larkup',
    'tools',
    'bin',
    process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
  );
}

async function ensureYtDlp(executable: string) {
  if (process.env.LARKUP_YTDLP_PATH?.trim()) return;
  try {
    await fs.access(executable);
    return;
  } catch {
    // Download the official standalone binary once; no optional npm package is involved.
  }
  const asset =
    process.platform === 'darwin'
      ? 'yt-dlp_macos'
      : process.platform === 'win32'
        ? 'yt-dlp.exe'
        : process.arch === 'arm64'
          ? 'yt-dlp_linux_aarch64'
          : 'yt-dlp_linux';
  const temporary = `${executable}.${randomUUID()}.download`;
  try {
    await fs.mkdir(path.dirname(executable), { recursive: true });
    const response = await fetch(
      `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`,
      {
        redirect: 'follow',
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) throw new Error(`download returned HTTP ${response.status}`);
    await fs.writeFile(temporary, Buffer.from(await response.arrayBuffer()), { mode: 0o755 });
    if (process.platform !== 'win32') await fs.chmod(temporary, 0o755);
    await fs.rename(temporary, executable);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not prepare the built-in YouTube downloader (${message}).`);
  }
}

function runProcess(
  command: string,
  args: string[],
  onProgress?: (progress: MediaImportProgress) => void,
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { shell: false });
    let stdout = '';
    let stderr = '';
    let progressBuffer = '';
    const startedAt = Date.now();
    let latestProgress: MediaImportProgress | undefined;
    const timeout = setTimeout(() => child.kill('SIGTERM'), 120_000);
    const activityHeartbeat = onProgress
      ? setInterval(() => {
          const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1_000);
          onProgress({
            ...latestProgress,
            elapsedSeconds,
            message: latestProgress?.percent
              ? `${latestProgress.message} · active ${elapsedSeconds}s`
              : `Connecting to the video source · ${elapsedSeconds}s`,
          });
        }, 1_000)
      : undefined;
    child.stdout.on('data', (data) => (stdout += String(data)));
    child.stderr.on('data', (data) => {
      const text = String(data);
      stderr += text;
      progressBuffer += text;
      const lines = progressBuffer.split(/[\r\n]+/);
      progressBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const progress = parseYtDlpProgress(line, Math.floor((Date.now() - startedAt) / 1_000));
        if (!progress) continue;
        latestProgress = progress;
        onProgress?.(progress);
      }
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      if (activityHeartbeat) clearInterval(activityHeartbeat);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (activityHeartbeat) clearInterval(activityHeartbeat);
      const finalProgress = parseYtDlpProgress(
        progressBuffer,
        Math.floor((Date.now() - startedAt) / 1_000),
      );
      if (finalProgress) onProgress?.(finalProgress);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${path.basename(command)} failed (${code}): ${stderr.trim()}`));
    });
  });
}

export function parseYtDlpProgress(line: string, elapsedSeconds = 0): MediaImportProgress | null {
  const percentMatch = line.match(/(\d+(?:\.\d+)?)%/);
  if (!percentMatch) return null;
  const percent = Math.min(99, Math.max(0, Number(percentMatch[1])));
  if (!Number.isFinite(percent)) return null;

  const totalMatch = line.match(/\bof\s+~?\s*([\d.]+)\s*(KiB|MiB|GiB|KB|MB|GB)\b/i);
  const total = totalMatch ? byteCount(Number(totalMatch[1]), totalMatch[2]) : undefined;
  const current = total ? (total * percent) / 100 : undefined;
  const speed = line.match(/\bat\s+([^\s]+\/s)\b/i)?.[1];
  const etaText = line.match(/\bETA\s+(\d{1,2}:\d{2}(?::\d{2})?)\b/i)?.[1];
  const estimatedRemainingSeconds = etaText ? durationTextSeconds(etaText) : undefined;

  return {
    percent,
    ...(current !== undefined ? { current } : {}),
    ...(total !== undefined ? { total, unit: 'bytes' } : {}),
    elapsedSeconds,
    estimatedRemainingSeconds,
    message: [
      `Downloading video · ${formatProgressPercent(percent)}%`,
      speed,
      etaText ? `${etaText} left` : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

function durationTextSeconds(value: string): number | undefined {
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3_600 + parts[1] * 60 + parts[2];
  return undefined;
}

function byteCount(value: number, unit: string): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const exponent = ({ KiB: 1, MiB: 2, GiB: 3, KB: 1, MB: 2, GB: 3 } as Record<string, number>)[
    unit
  ];
  if (exponent === undefined) return undefined;
  const base = unit.endsWith('iB') ? 1_024 : 1_000;
  return value * base ** exponent;
}

function formatByteCount(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1_024) return `${Math.max(0, Math.round(bytes))} B`;
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KiB`;
  if (bytes < 1_024 ** 3) return `${(bytes / 1_024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1_024 ** 3).toFixed(2)} GiB`;
}

function formatProgressPercent(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function validHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('Only http(s) media URLs are supported.');
  return url;
}

async function fetchPublic(url: string, init: RequestInit = {}) {
  let current = validHttpUrl(url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicHost(current.hostname);
    const response = await fetch(current, { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('Media URL redirected without a location.');
    current = validHttpUrl(new URL(location, current).toString());
  }
  throw new Error('Media URL redirected too many times.');
}

async function assertPublicHost(hostname: string) {
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Private or local media URLs are not supported.');
  }
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  )
    return true;
  const parts = (normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized)
    .split('.')
    .map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isYouTube(url: URL) {
  return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(url.hostname);
}

function mediaTypeFromMime(mime?: string): RemoteMediaType {
  return mime?.startsWith('video/') ? 'video' : mime?.startsWith('audio/') ? 'audio' : 'unknown';
}

function mimeFromExtension(extension: string) {
  return (
    {
      mp4: 'video/mp4',
      webm: 'video/webm',
      mkv: 'video/x-matroska',
      mov: 'video/quicktime',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
    } as Record<string, string>
  )[extension.toLowerCase()];
}
