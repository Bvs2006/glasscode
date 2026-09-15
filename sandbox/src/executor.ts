import { spawn, execSync } from 'child_process';
import path from 'path';

export interface SandboxOptions {
  workingDir: string;
  command: string;
  image?: string;
  timeoutMs?: number;
  allowNetwork?: boolean;
  cpuLimit?: string;
  memoryLimit?: string;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  runtime: string;
  error?: string;
}

let cachedGVisorSupported: boolean | null = null;

/**
 * Checks if Docker daemon has gVisor (runsc) runtime installed and registered
 */
export function checkGVisorSupported(): boolean {
  if (cachedGVisorSupported !== null) {
    return cachedGVisorSupported;
  }
  try {
    const output = execSync('docker info --format "{{json .Runtimes}}"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    cachedGVisorSupported = output.includes('runsc');
    if (cachedGVisorSupported) {
      console.log('[Sandbox] gVisor (runsc) runtime detected and active.');
    } else {
      console.warn(
        '[Sandbox WARNING] gVisor (runsc) runtime is not registered in Docker daemon. Hardened container isolation will be enforced.'
      );
    }
  } catch (err) {
    cachedGVisorSupported = false;
  }
  return cachedGVisorSupported;
}

/**
 * Runs a command inside a secured, sandboxed container
 */
export async function runSandbox(options: SandboxOptions): Promise<SandboxResult> {
  const {
    workingDir,
    command,
    image = 'alpine:latest',
    timeoutMs = 5000,
    allowNetwork = false,
    cpuLimit = '0.5',
    memoryLimit = '128m',
  } = options;

  const hasGVisor = checkGVisorSupported();
  const runtime = hasGVisor ? 'runsc' : 'docker-hardened';

  const containerName = `sbx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const normalizedWorkingDir = path.resolve(workingDir);

  const dockerArgs: string[] = [
    'run',
    '--name',
    containerName,
    '--rm',
    // Mount root filesystem as read-only
    '--read-only',
    // Mount temporary scratch space
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    // Scope filesystem mount strictly to working directory
    '-v',
    `${normalizedWorkingDir}:/workspace:rw`,
    '-w',
    '/workspace',
    // Resource limits
    `--cpus=${cpuLimit}`,
    `-m=${memoryLimit}`,
    '--pids-limit=64',
  ];

  // Apply gVisor runtime if supported, otherwise apply strict security opts
  if (hasGVisor) {
    dockerArgs.push('--runtime=runsc');
  } else {
    dockerArgs.push('--security-opt=no-new-privileges');
    dockerArgs.push('--cap-drop=ALL');
  }

  // Network isolation
  if (!allowNetwork) {
    dockerArgs.push('--network=none');
  }

  // Image and command
  dockerArgs.push(image);
  dockerArgs.push('sh', '-c', command);

  const startTime = Date.now();
  let stdoutData = '';
  let stderrData = '';
  let timedOut = false;

  return new Promise<SandboxResult>((resolve) => {
    const child = spawn('docker', dockerArgs, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Hard execution timeout handler
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        // Kill the docker container immediately
        execSync(`docker kill ${containerName}`, { stdio: 'ignore' });
      } catch (e) {}
      try {
        child.kill('SIGKILL');
      } catch (e) {}
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      // Defensive cleanup: make sure container is completely destroyed
      try {
        execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });
      } catch (e) {}

      resolve({
        stdout: stdoutData,
        stderr: stderrData,
        exitCode: timedOut ? null : code,
        timedOut,
        durationMs,
        runtime,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      resolve({
        stdout: stdoutData,
        stderr: stderrData,
        exitCode: -1,
        timedOut: false,
        durationMs,
        runtime,
        error: err.message,
      });
    });
  });
}
