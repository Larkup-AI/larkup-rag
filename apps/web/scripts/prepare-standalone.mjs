import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const standaloneRoot = path.resolve('.next/standalone');
const appRoot = path.join(standaloneRoot, 'apps/web');

if (!existsSync(standaloneRoot)) {
  process.exit(0);
}

removeDanglingSymlinks(standaloneRoot);

rmSync(path.join(appRoot, '.env.local'), { force: true });
rmSync(path.join(appRoot, 'public'), { force: true, recursive: true });

copyDirectory('.next/static', path.join(appRoot, '.next/static'));
copyDirectory('public', path.join(appRoot, 'public'));
copyBundledFfprobe();

pruneOtherPlatformNativePackages();
removePrivateRuntimeState(standaloneRoot);
removeEnvFiles(standaloneRoot);
removeBuildCaches(standaloneRoot);
removeDanglingSymlinks(standaloneRoot);

function copyDirectory(source, destination) {
  if (!existsSync(source)) return;

  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}

/**
 * The ffprobe installer resolves its platform package dynamically, which Next's
 * output tracer cannot see. Copy that one platform package beside the traced
 * wrapper so CLI/desktop installs can probe video without relying on PATH.
 */
function copyBundledFfprobe() {
  const requireFromApp = createRequire(import.meta.url);
  const platformPackage = `${process.platform}-${process.arch}`;
  const standaloneWrapper = path.join(appRoot, 'node_modules/@ffprobe-installer/ffprobe');
  if (!existsSync(standaloneWrapper)) return;
  try {
    const bundled = requireFromApp('@ffprobe-installer/ffprobe');
    const wrapperRoot = realpathSync(standaloneWrapper);
    copyDirectory(
      path.dirname(bundled.path),
      path.join(path.dirname(wrapperRoot), platformPackage),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not package ffprobe for the standalone server: ${message}`);
  }
}

function pruneOtherPlatformNativePackages() {
  const packageStore = path.join(standaloneRoot, 'node_modules/.pnpm');
  if (!existsSync(packageStore)) return;

  const libc =
    process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime
      ? 'musl'
      : 'gnu';
  const napiPlatform =
    process.platform === 'linux'
      ? `linux-${process.arch}-${libc}`
      : process.platform === 'win32'
        ? `win32-${process.arch}-msvc`
        : `${process.platform}-${process.arch}`;
  const sharpPlatform =
    process.platform === 'linux' && libc === 'musl'
      ? `linuxmusl-${process.arch}`
      : `${process.platform}-${process.arch}`;
  const keepPrefixes = [
    `@lancedb+lancedb-${napiPlatform}@`,
    `@napi-rs+canvas-${napiPlatform}@`,
    `@img+sharp-${sharpPlatform}@`,
    `@img+sharp-libvips-${sharpPlatform}@`,
  ];

  for (const entry of readdirSync(packageStore)) {
    const isNativePackage = /^(?:@lancedb\+lancedb-|@napi-rs\+canvas-|@img\+sharp-)/.test(entry);
    if (isNativePackage && !keepPrefixes.some((prefix) => entry.startsWith(prefix))) {
      rmSync(path.join(packageStore, entry), { force: true, recursive: true });
    }
  }
}

function removePrivateRuntimeState(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const entryPath = path.join(directory, entry.name);
    if (entry.name === '.larkup' || entry.name === '.larkupdb') {
      rmSync(entryPath, { force: true, recursive: true });
      continue;
    }
    removePrivateRuntimeState(entryPath);
  }
}

/**
 * Next traces workspace siblings into the standalone tree, so a publish from a
 * working copy would carry private env files and local project state straight
 * into a public tarball. CI publishes from a clean checkout where these do not
 * exist; these scrubbers make a local publish safe too.
 */
function removeEnvFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      removeEnvFiles(entryPath);
      continue;
    }
    if (/^\.env($|\.)/.test(entry.name) && entry.name !== '.env.example') {
      rmSync(entryPath, { force: true });
    }
  }
}

function removeBuildCaches(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (!entry.isDirectory()) continue;

    if (entry.name === '.venv' || entry.name === '.turbo') {
      rmSync(entryPath, { force: true, recursive: true });
      continue;
    }

    if (entry.name === '.next') {
      rmSync(path.join(entryPath, 'cache'), { force: true, recursive: true });
      rmSync(path.join(entryPath, 'dev'), { force: true, recursive: true });
    }

    removeBuildCaches(entryPath);
  }
}

function removeDanglingSymlinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const stat = lstatSync(entryPath);

    if (stat.isSymbolicLink()) {
      if (!existsSync(entryPath)) rmSync(entryPath, { force: true });
      continue;
    }

    if (stat.isDirectory()) removeDanglingSymlinks(entryPath);
  }
}
