import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type {
  ExecutionArtifact,
  ExecutionRequest,
  ExecutionResult,
  SandboxHealthCheck,
} from './types.js';
import { getMimeType } from './mime.js';

type Command = { executable: string; args: string[] };

let pythonCommand: Command | null | undefined;

// Keep this list in sync with the capabilities advertised by executeAnalysis
// and analyzeCorpusWithCode. A bare Python installation is not an analysis
// runtime, so it must not make those tools appear available.
const ANALYSIS_PYTHON_MODULES = ['numpy', 'pandas', 'matplotlib', 'scipy', 'sklearn', 'seaborn'];

function run(command: Command, args: string[], cwd?: string, timeoutMs = 10_000) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const child = spawn(command.executable, [...command.args, ...args], {
      cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Node ChildProcess is an EventEmitter at runtime. TypeScript 7's narrowed stdio return type
    // omits that inherited surface, so retain it explicitly for lifecycle events.
    const lifecycle = child as unknown as EventEmitter;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-1_000_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-1_000_000);
    });
    lifecycle.once('error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
    lifecycle.once('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: timedOut ? `${stderr}\nExecution timed out.`.trim() : stderr,
        exitCode: timedOut ? 124 : (code ?? 1),
      });
    });
  });
}

async function resolvePython(): Promise<Command | null> {
  if (pythonCommand !== undefined) return pythonCommand;
  const candidates: Command[] = process.env.LARKUP_PYTHON
    ? [{ executable: process.env.LARKUP_PYTHON, args: [] }]
    : process.platform === 'win32'
      ? [
          { executable: 'py', args: ['-3'] },
          { executable: 'python', args: [] },
        ]
      : [
          { executable: 'python3', args: [] },
          { executable: 'python', args: [] },
        ];

  for (const candidate of candidates) {
    try {
      if ((await run(candidate, ['--version'])).exitCode === 0) {
        pythonCommand = candidate;
        return candidate;
      }
    } catch {
      continue;
    }
  }
  pythonCommand = null;
  return null;
}

function assertSafeFileName(name: string) {
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
    throw new Error('Sandbox file names must be plain file names.');
  }
}

function pythonWrapper(code: string, outputDir: string) {
  return `import base64, os, sys, traceback
os.makedirs(${JSON.stringify(outputDir)}, exist_ok=True)
os.environ.setdefault('MPLBACKEND', 'Agg')
try:
    import numpy as np
    import pandas as pd
except ImportError:
    pass
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    def _save_figures(*args, **kwargs):
        for i, number in enumerate(plt.get_fignums()):
            plt.figure(number).savefig(os.path.join(${JSON.stringify(
              outputDir,
            )}, f'chart_{i}.png'), dpi=150, bbox_inches='tight')
        plt.close('all')
    plt.show = _save_figures
except ImportError:
    pass
try:
    exec(compile(base64.b64decode(${JSON.stringify(
      Buffer.from(code).toString('base64'),
    )}), 'analysis.py', 'exec'))
    if 'plt' in globals() and plt.get_fignums():
        plt.show()
except Exception as error:
    traceback.print_exception(error, file=sys.stderr)
    sys.exit(1)
`;
}

/** Checks whether the host can run Python analysis without Docker. */
export async function checkLocalRuntime(): Promise<SandboxHealthCheck> {
  const python = await resolvePython();
  if (!python) {
    return {
      status: 'error',
      backend: 'local',
      error:
        'Local code execution needs Python 3. Install Python or choose Docker or a remote sandbox provider.',
    };
  }

  try {
    const dependencyCheck = await run(python, [
      '-c',
      `import importlib.util\nmodules = ${JSON.stringify(
        ANALYSIS_PYTHON_MODULES,
      )}\nmissing = [name for name in modules if importlib.util.find_spec(name) is None]\nprint(','.join(missing))\nraise SystemExit(bool(missing))`,
    ]);
    if (dependencyCheck.exitCode !== 0) {
      const missing = dependencyCheck.stdout.trim() || 'required analysis packages';
      return {
        status: 'error',
        backend: 'local',
        error:
          `Local Python is missing ${missing}. Install the Larkup analysis dependencies ` +
          `(for example: pip install ${ANALYSIS_PYTHON_MODULES.join(' ')}) or choose Docker or a remote sandbox provider.`,
      };
    }
  } catch {
    return {
      status: 'error',
      backend: 'local',
      error:
        'Larkup could not verify the Python analysis dependencies. Choose Docker or a remote sandbox provider.',
    };
  }
  return { status: 'ready', backend: 'local' };
}

/** Executes trusted code in a temporary host workspace and collects its output. */
export async function executeLocally(request: ExecutionRequest): Promise<ExecutionResult> {
  const startTime = Date.now();
  const tempDir = path.join(os.tmpdir(), `larkup-local-${randomUUID()}`);
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  try {
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    for (const file of request.files ?? []) {
      assertSafeFileName(file.name);
      await fs.writeFile(
        path.join(inputDir, file.name),
        file.isBase64 ? Buffer.from(file.content, 'base64') : file.content,
      );
    }

    const isPython = request.language === 'python';
    const command = isPython ? await resolvePython() : { executable: process.execPath, args: [] };
    if (!command) {
      return {
        stdout: '',
        stderr:
          'Local code execution needs Python 3. Install Python or choose Docker or a remote sandbox provider.',
        exitCode: 1,
        artifacts: [],
        executionTimeMs: Date.now() - startTime,
      };
    }

    const script = path.join(tempDir, isPython ? 'run.py' : 'run.js');
    const source = isPython
      ? pythonWrapper(request.code, outputDir)
      : `process.env.LARKUP_OUTPUT_DIR = ${JSON.stringify(outputDir)};\n${request.code}`;
    await fs.writeFile(script, source, 'utf8');
    const result = await run(command, [script], inputDir, request.timeout ?? 30_000);
    const artifacts: ExecutionArtifact[] = [];
    for (const name of await fs.readdir(outputDir).catch(() => [])) {
      const filePath = path.join(outputDir, name);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile()) continue;
      artifacts.push({
        name,
        mimeType: getMimeType(name),
        data: (await fs.readFile(filePath)).toString('base64'),
      });
    }
    return { ...result, artifacts, executionTimeMs: Date.now() - startTime };
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : 'Local execution failed.',
      exitCode: 1,
      artifacts: [],
      executionTimeMs: Date.now() - startTime,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
