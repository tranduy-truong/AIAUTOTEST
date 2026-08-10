import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { ModelAdapter, RunOptions, AgentResult } from "./index.js";

export class OllamaAdapter implements ModelAdapter {
  id = "ollama" as const;
  displayName = "Ollama Local (qwen2.5-coder)";
  modelName: string;

  constructor(modelName = "qwen2.5-coder") {
    this.modelName = modelName;
  }

  async isAvailable(): Promise<boolean> {
    try {
      execSync("ollama --version", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  async run(opts: RunOptions): Promise<AgentResult> {
    const start = Date.now();
    const taskPath = path.join(opts.promptDir, "task.md");
    
   
    const prompt = fs.existsSync(taskPath) ? fs.readFileSync(taskPath, "utf-8") : "";

    try {
      console.log(`🧠 [Ollama] Đang xử lý task từ: ${opts.promptDir}...`);
      
     
      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelName,
          prompt: prompt,
          stream: false
        })
      });

      const data = await response.json();
      
      return {
        ok: true,
        rawOutput: data.response,
        durationMs: Date.now() - start
      };
    } catch (error) {
      return {
        ok: false,
        rawOutput: String(error),
        durationMs: Date.now() - start
      };
    }
  }
}