import { spawn, ChildProcess } from 'child_process';
import net from 'net';
import fs from 'fs';
import { redactSecrets } from './security-policy.js';

export interface ManagedProcessOptions {
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  logPath?: string;
}

export interface ManagedProcessResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const activeProcesses = new Set<ChildProcess>();
const activeCleanupCallbacks = new Set<() => Promise<void> | void>();
let globalCleanupRegistered = false;

export function findFreePort(preferredPort = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', (err: any) => {
      if (preferredPort !== 0 && err.code === 'EADDRINUSE') {
        findFreePort(0).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });

    server.listen(preferredPort, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : preferredPort;
      server.close(() => resolve(port));
    });
  });
}

export function registerGlobalCleanupHandler(onCleanup: () => Promise<void> | void): () => void {
  activeCleanupCallbacks.add(onCleanup);

  if (!globalCleanupRegistered) {
    globalCleanupRegistered = true;

    const handleSignal = async (source: string, errorDetail?: any) => {
      console.log(`\n⚠️ [Process Manager] Nhận sự kiện ${source}. Đang thực thi Teardown tài nguyên...`);
      if (errorDetail && (source === 'uncaughtException' || source === 'unhandledRejection')) {
        console.error(`❌ Chi tiết lỗi ngắt tiến trình:`, errorDetail);
      }

      for (const cb of Array.from(activeCleanupCallbacks)) {
        try {
          await cb();
        } catch (err) {
          console.error('Lỗi khi chạy cleanup callback:', err);
        }
      }

      terminateManagedProcesses();
      if (source !== 'exit') {
        process.exit(130);
      }
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    process.on('exit', () => handleSignal('exit'));
    process.on('uncaughtException', (err) => handleSignal('uncaughtException', err));
    process.on('unhandledRejection', (reason) => handleSignal('unhandledRejection', reason));
  }

  // Return unregister function
  return () => {
    activeCleanupCallbacks.delete(onCleanup);
  };
}

export function terminateManagedProcesses(): void {
  for (const child of activeProcesses) {
    try {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    } catch {
      // Ignore cleanup errors
    }
  }
  activeProcesses.clear();
}

export function spawnManagedProcess(
  commandLine: string,
  opts: ManagedProcessOptions,
): Promise<ManagedProcessResult> {
  return new Promise(resolve => {
    const start = Date.now();
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const shellArgs = isWindows ? ['/d', '/s', '/c', commandLine] : ['-c', commandLine];

    const child = spawn(shell, shellArgs, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      windowsVerbatimArguments: true,
    });

    activeProcesses.add(child);

    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, opts.timeoutMs);
    }

    child.stdout?.on('data', data => {
      const text = data.toString();
      stdout += text;
      if (opts.logPath) {
        fs.appendFileSync(opts.logPath, redactSecrets(text));
      }
    });

    child.stderr?.on('data', data => {
      const text = data.toString();
      stderr += text;
      if (opts.logPath) {
        fs.appendFileSync(opts.logPath, redactSecrets(text));
      }
    });

    child.on('close', code => {
      if (timer) clearTimeout(timer);
      activeProcesses.delete(child);
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    });

    child.on('error', err => {
      if (timer) clearTimeout(timer);
      activeProcesses.delete(child);
      resolve({
        ok: false,
        exitCode: -1,
        stdout,
        stderr: err.message,
        durationMs: Date.now() - start,
      });
    });
  });
}

export function spawnDaemonProcess(
  commandLine: string,
  opts: ManagedProcessOptions,
): ChildProcess {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : '/bin/sh';
  const shellArgs = isWindows ? ['/d', '/s', '/c', commandLine] : ['-c', commandLine];

  const child = spawn(shell, shellArgs, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    windowsVerbatimArguments: true,
  });

  activeProcesses.add(child);

  if (opts.logPath) {
    child.stdout?.on('data', d => fs.appendFileSync(opts.logPath!, redactSecrets(d.toString())));
    child.stderr?.on('data', d => fs.appendFileSync(opts.logPath!, redactSecrets(d.toString())));
  }

  return child;
}
