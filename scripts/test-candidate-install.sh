#!/usr/bin/env bash
set -euo pipefail

# Builds the candidate package for this native runner, installs its tarball into
# an empty npm prefix, then verifies the bundled ffprobe binary and server.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/larkup-candidate-install.XXXXXX")"
SERVER_PID=""

cleanup() {
  local code=$?
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_ROOT"
  exit "$code"
}
trap cleanup EXIT INT TERM

cd "$PROJECT_ROOT"
pnpm -r --filter '{apps/web}...' --if-present build
mkdir -p "$TEST_ROOT/pack-cache"
(cd apps/web && NPM_CONFIG_CACHE="$TEST_ROOT/pack-cache" npm pack --pack-destination "$TEST_ROOT" --ignore-scripts >/dev/null)

PACKAGE_TARBALL="$(find "$TEST_ROOT" -maxdepth 1 -name 'larkup-*.tgz' -print -quit)"
if [[ -z "$PACKAGE_TARBALL" ]]; then
  echo 'Candidate package tarball was not created.' >&2
  exit 1
fi

export HOME="$TEST_ROOT/home"
export NPM_CONFIG_CACHE="$TEST_ROOT/npm-cache"
export NPM_CONFIG_PREFIX="$TEST_ROOT/npm-prefix"
mkdir -p "$HOME" "$NPM_CONFIG_CACHE" "$NPM_CONFIG_PREFIX/bin" "$NPM_CONFIG_PREFIX/lib"
npm install -g --prefix "$NPM_CONFIG_PREFIX" --no-audit --no-fund "$PACKAGE_TARBALL" >/dev/null
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
command -v larkup
larkup --version

INSTALLED_PACKAGE="$NPM_CONFIG_PREFIX/lib/node_modules/larkup"
NODE_BIN="$(command -v node)"
"$NODE_BIN" - "$INSTALLED_PACKAGE" <<'NODE'
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { existsSync } = require('node:fs');
const path = require('node:path');

const packageRoot = process.argv[2];
const server = path.join(packageRoot, '.next', 'standalone', 'apps', 'web', 'server.js');
const requireFromServer = createRequire(server);
const ffprobe = requireFromServer('@ffprobe-installer/ffprobe');
if (!existsSync(ffprobe.path)) throw new Error(`Bundled ffprobe is missing: ${ffprobe.path}`);
const result = spawnSync(ffprobe.path, ['-version'], {
  encoding: 'utf8',
  env: { ...process.env, PATH: '/usr/bin:/bin' },
});
if (result.status !== 0) throw new Error(result.stderr || 'Bundled ffprobe did not start.');
console.log(`Bundled ffprobe is executable: ${ffprobe.path}`);
NODE

PORT=4568 larkup start >"$TEST_ROOT/larkup.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error "http://127.0.0.1:4568/" >/dev/null; then
    echo 'Candidate Larkup server is healthy.'
    exit 0
  fi
  sleep 1
done

tail -n 100 "$TEST_ROOT/larkup.log" >&2 || true
echo 'Candidate Larkup server did not become healthy.' >&2
exit 1
