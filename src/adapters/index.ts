export interface RunOptions {
  promptDir: string; 
  workDir: string; 
  timeoutMs: number; 
  maxTurns?: number;
  allowedTools?: string[]; 
}

export interface AgentResult {
  ok: boolean;
  rawOutput: string;
  structuredOutput?: unknown;
  costUsd?: number;
  durationMs: number;
}

export interface ModelAdapter {
  id:
    | "claude-code"
    | "copilot-cli"
    | "codex-cli"
    | "antigravity-cli"
    | "ollama";
  displayName: string;
  isAvailable(): Promise<boolean>; 
  run(opts: RunOptions): Promise<AgentResult>;
}
