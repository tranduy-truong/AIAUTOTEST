import fs from "fs";
import path from "path";
import OpenAI from "openai";
import "dotenv/config";

export class OpenAIAdapter {
  model: string;
  client: OpenAI;

  constructor(modelName?: string) {
    // 1. Xác định API Key (ưu tiên GEMINI/GOOGLE -> CEREBRAS -> GROQ -> OPENAI)
    const apiKey =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.CEREBRAS_API_KEY ||
      process.env.GROQ_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.AI_API_KEY ||
      "";

    // 2. Tự động nhận diện Base URL theo loại key / env
    let defaultBaseURL = "https://generativelanguage.googleapis.com/v1beta/openai/";
    if (apiKey.startsWith("AIzaSy") || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      defaultBaseURL = "https://generativelanguage.googleapis.com/v1beta/openai/";
    } else if (apiKey.startsWith("gsk_") || process.env.GROQ_API_KEY) {
      defaultBaseURL = "https://api.groq.com/openai/v1";
    } else if (apiKey.startsWith("csk-") || process.env.CEREBRAS_API_KEY) {
      defaultBaseURL = "https://api.cerebras.ai/v1";
    }

    const baseURL =
      process.env.AI_BASE_URL ||
      process.env.GEMINI_BASE_URL ||
      process.env.CEREBRAS_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      defaultBaseURL;

    // 3. Xác định Model
    let defaultModel = "gemini-flash-latest";
    if (apiKey.startsWith("gsk_")) {
      defaultModel = "llama-3.3-70b-versatile";
    } else if (apiKey.startsWith("csk-")) {
      defaultModel = "gpt-oss-120b";
    }

    this.model =
      modelName ||
      process.env.AI_MODEL ||
      process.env.GEMINI_MODEL ||
      process.env.CEREBRAS_MODEL ||
      process.env.OPENAI_MODEL ||
      defaultModel;

    this.client = new OpenAI({
      apiKey,
      baseURL,
      dangerouslyAllowBrowser: true,
    });
  }

  async run({
    promptDir,
    workDir,
    timeoutMs,
    maxTokens,
  }: {
    promptDir: string;
    workDir: string;
    timeoutMs: number;
    maxTokens?: number;
  }) {
    try {
      const taskContent = fs.readFileSync(
        path.join(promptDir, "task.md"),
        "utf-8",
      );

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: "user", content: taskContent }],
        temperature: 0.1,
        max_tokens: maxTokens,
      });

      const output = response.choices[0].message.content || "";
      return { ok: true, rawOutput: output };
    } catch (error: any) {
      console.error("Lỗi AI API:", error);
      return { ok: false, rawOutput: error.message };
    }
  }
}
