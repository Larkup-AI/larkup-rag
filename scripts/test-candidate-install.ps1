# Builds the candidate package for this native runner, installs its tarball into
# an empty npm prefix, then verifies the bundled ffprobe binary and server.
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("larkup-candidate-install-" + [guid]::NewGuid())
$ServerProcess = $null

try {
    New-Item -ItemType Directory -Path $TestRoot -Force | Out-Null
    Push-Location $ProjectRoot
    try {
        pnpm --filter larkup build
        Push-Location (Join-Path $ProjectRoot 'apps/web')
        $env:NPM_CONFIG_CACHE = Join-Path $TestRoot 'pack-cache'
        New-Item -ItemType Directory -Path $env:NPM_CONFIG_CACHE -Force | Out-Null
        try { npm pack --pack-destination $TestRoot --ignore-scripts | Out-Null } finally { Pop-Location }
    } finally { Pop-Location }

    $PackageTarball = Get-ChildItem -Path $TestRoot -Filter 'larkup-*.tgz' | Select-Object -First 1
    if (-not $PackageTarball) { throw 'Candidate package tarball was not created.' }
    $env:HOME = Join-Path $TestRoot 'home'
    $env:USERPROFILE = $env:HOME
    $env:APPDATA = Join-Path $TestRoot 'appdata'
    $env:LOCALAPPDATA = Join-Path $TestRoot 'localappdata'
    $env:NPM_CONFIG_CACHE = Join-Path $TestRoot 'npm-cache'
    $env:NPM_CONFIG_PREFIX = Join-Path $TestRoot 'npm-prefix'
    New-Item -ItemType Directory -Path $env:HOME, $env:APPDATA, $env:LOCALAPPDATA, $env:NPM_CONFIG_CACHE, (Join-Path $env:NPM_CONFIG_PREFIX 'bin'), (Join-Path $env:NPM_CONFIG_PREFIX 'lib') -Force | Out-Null
    npm install -g --prefix $env:NPM_CONFIG_PREFIX --no-audit --no-fund $PackageTarball.FullName | Out-Null

    $npmPrefix = @($env:NPM_CONFIG_PREFIX, (Join-Path $env:APPDATA 'npm')) |
        Where-Object { $_ -and (Test-Path (Join-Path $_ 'larkup.cmd')) } |
        Select-Object -First 1
    if (-not $npmPrefix) { throw 'The candidate install did not create larkup.cmd.' }
    $env:Path = "$npmPrefix;$env:Path"
    & larkup --version
    if ($LASTEXITCODE -ne 0) { throw 'The candidate larkup command did not report a version.' }

    $probeScript = Join-Path $TestRoot 'verify-ffprobe.cjs'
    @'
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { existsSync } = require('node:fs');
const path = require('node:path');
const packageRoot = process.argv[2];
const server = path.join(packageRoot, '.next', 'standalone', 'apps', 'web', 'server.js');
const requireFromServer = createRequire(server);
const ffprobe = requireFromServer('@ffprobe-installer/ffprobe');
if (!existsSync(ffprobe.path)) throw new Error(`Bundled ffprobe is missing: ${ffprobe.path}`);
const result = spawnSync(ffprobe.path, ['-version'], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || 'Bundled ffprobe did not start.');
console.log(`Bundled ffprobe is executable: ${ffprobe.path}`);
'@ | Set-Content -Path $probeScript -NoNewline
    $installedPackage = @(
        (Join-Path $env:NPM_CONFIG_PREFIX 'node_modules/larkup'),
        (Join-Path $env:NPM_CONFIG_PREFIX 'lib/node_modules/larkup')
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $installedPackage) { throw 'The candidate Larkup package directory was not found.' }
    & node $probeScript $installedPackage
    if ($LASTEXITCODE -ne 0) { throw 'The candidate bundled ffprobe did not run.' }

    $stdoutPath = Join-Path $TestRoot 'larkup.stdout.log'
    $stderrPath = Join-Path $TestRoot 'larkup.stderr.log'
    $env:PORT = '4568'
    $ServerProcess = Start-Process -FilePath 'larkup.cmd' -ArgumentList 'start' -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4568/' -TimeoutSec 2
            if ($response.StatusCode -lt 500) {
                Write-Host 'Candidate Larkup server is healthy.'
                exit 0
            }
        } catch {}
        Start-Sleep -Seconds 1
    }

    if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Tail 100 }
    if (Test-Path $stderrPath) { Get-Content $stderrPath -Tail 100 }
    throw 'Candidate Larkup server did not become healthy.'
} finally {
    if ($ServerProcess -and -not $ServerProcess.HasExited) { Stop-Process -Id $ServerProcess.Id -Force }
    if (Test-Path $TestRoot) { Remove-Item -Recurse -Force $TestRoot -ErrorAction SilentlyContinue }
}
