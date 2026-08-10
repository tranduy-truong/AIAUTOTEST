import { spawn } from "node:child_process";
import { RunOptions, AgentResult } from "../adapters/index.js";

function buildScrubbedEnv(opts: RunOptions) {
  const safeEnv = { ...process.env };

  return safeEnv;
}

export function runIsolated(
  bin: string,
  args: string[],
  opts: RunOptions,
): Promise<AgentResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const child = spawn(bin, args, {
      cwd: opts.workDir,
      env: buildScrubbedEnv(opts),
      timeout: opts.timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        rawOutput: stdout || stderr,
        durationMs: Date.now() - start,
      });
    });

    child.on("error", (err) => {
      reject({
        ok: false,
        rawOutput: err.message,
        durationMs: Date.now() - start,
      });
    });
  });
}
