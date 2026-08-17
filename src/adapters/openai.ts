import fs from "fs";
import path from "path";
import OpenAI from "openai";
import "dotenv/config";

export type AIProvider = "gemini" | "groq" | "openai" | "custom";

export class OpenAIAdapter {
  model: string;
  provider: AIProvider;
  client: OpenAI;

  constructor(modelName?: string) {
    // 1. Xác định Provider từ biến môi trường hoặc tự động nhận diện từ API key
    const explicitProvider = process.env.AI_PROVIDER?.trim().toLowerCase() as AIProvider | undefined;
    const geminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim().replace(/^['"]+|['"]+$/g, "");
    const groqKey = (process.env.GROQ_API_KEY || "").trim().replace(/^['"]+|['"]+$/g, "");
    const openAIKey = (process.env.OPENAI_API_KEY || "").trim().replace(/^['"]+|['"]+$/g, "");

    let envModel = (process.env.AI_MODEL || "").trim().replace(/^['"]+|['"]+$/g, "");
    if (envModel.startsWith("models/")) {
      envModel = envModel.replace(/^models\//, "");
    }

    if (explicitProvider) {
      this.provider = explicitProvider;
    } else if (groqKey && (envModel.includes("llama") || envModel.includes("qwen") || envModel.includes("mixtral") || !geminiKey)) {
      this.provider = "groq";
    } else if (geminiKey) {
      this.provider = "gemini";
    } else if (groqKey) {
      this.provider = "groq";
    } else if (openAIKey) {
      this.provider = "openai";
    } else {
      this.provider = "gemini";
    }

    let apiKey = "MISSING_KEY";
    let baseURL: string | undefined;

    // 2. Cấu hình baseURL, API key và tự động đồng bộ model tương thích với từng provider
    switch (this.provider) {
      case "gemini": {
        apiKey = geminiKey;
        baseURL = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/").trim();
        
        // Đảm bảo model luôn là model hợp lệ của Gemini (không bị gán nhầm model Llama)
        if (
          !envModel ||
          envModel.includes("llama") ||
          envModel.includes("gpt") ||
          envModel === "gemini-2.0-flash" ||
          envModel === "gemini-1.5-flash" ||
          envModel === "gemini-flash" ||
          envModel === "gemini" ||
          envModel === "gemini-flash-latest"
        ) {
          this.model = "gemini-3.7-flash";
        } else if (envModel === "gemini-pro" || envModel === "gemini-1.5-pro" || envModel === "gemini-pro-latest") {
          this.model = "gemini-3-flash-preview";
        } else {
          this.model = envModel;
        }

        if (!apiKey) {
          console.warn("⚠️ CẢNH BÁO: Chưa tìm thấy GEMINI_API_KEY trong file .env!");
        }
        break;
      }
      case "openai": {
        apiKey = openAIKey;
        baseURL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim();
        this.model = (envModel && !envModel.includes("llama") && !envModel.includes("gemini")) ? envModel : "gpt-4o-mini";
        if (!apiKey) {
          console.warn("⚠️ CẢNH BÁO: Chưa tìm thấy OPENAI_API_KEY trong file .env!");
        }
        break;
      }
      case "groq":
      default: {
        this.provider = "groq";
        apiKey = groqKey;
        baseURL = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").trim();
        this.model = (envModel && !envModel.includes("gemini") && !envModel.includes("gpt")) ? envModel : "llama-3.3-70b-versatile";
        if (!apiKey) {
          console.warn("⚠️ CẢNH BÁO: Chưa tìm thấy GROQ_API_KEY trong file .env!");
        }
        break;
      }
    }

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
    const taskContent = fs.readFileSync(
      path.join(promptDir, "task.md"),
      "utf-8"
    );
    let promptText = taskContent;

    // Chỉ cắt bớt prompt khi dùng Groq (do giới hạn 12,000 TPM thấp)
    // Gemini có context window 1,000,000 tokens nên không cần cắt
    // Đối với Gemini (context lớn), cho phép max_tokens lên tới 8192 để không bị cắt cụt JSON
    const effectiveMaxTokens = this.provider === "gemini"
      ? (maxTokens ? Math.max(maxTokens, 8192) : 8192)
      : maxTokens;

    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [{ role: "user", content: promptText }],
          temperature: 0.1,
          max_tokens: effectiveMaxTokens,
        });

        const output = response.choices[0].message.content || "";
        return { ok: true, rawOutput: output };
      } catch (error: any) {
        const status = error?.status;
        const msg = String(error?.message || "");

        const isRateLimit =
          status === 429 ||
          status === 413 ||
          error?.code === "rate_limit_exceeded" ||
          /rate.limit|quota|too many requests/i.test(msg);

        const isServerOverloaded =
          status === 503 ||
          status === 500 ||
          status === 502 ||
          status === 504 ||
          /overloaded|service unavailable|internal server error|bad gateway/i.test(msg);

        if ((isRateLimit || isServerOverloaded) && attempt < maxAttempts) {
          const waitSeconds = 30; // Chờ đủ 30s để hết hạn Rate Limit cửa sổ 1 phút
          const reasonText = isServerOverloaded
            ? `Máy chủ ${this.provider.toUpperCase()} đang quá tải tạm thời (${status ?? '503'})`
            : `${this.provider.toUpperCase()} đang chạm giới hạn RPM (Requests Per Minute)`;

          console.warn(
            `   ⏳ ${reasonText}. Tự động chờ ${waitSeconds}s rồi thử lại (${attempt}/${maxAttempts - 1})...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
          continue;
        }

        if (status === 401 || error?.code === "invalid_api_key") {
          console.error(
            `❌ Lỗi xác thực ${this.provider.toUpperCase()} API (401 Invalid Key): API Key trong file .env bị sai hoặc đã hết hạn.`
          );
        } else if (status === 404) {
          console.error(
            `❌ Lỗi không tìm thấy model (404 Not Found): Tên model '${this.model}' không tồn tại trên ${this.provider.toUpperCase()}. Vui lòng kiểm tra AI_MODEL trong file .env (ví dụ: gemini-2.0-flash hoặc gemini-1.5-flash).`
          );
        } else if (isRateLimit) {
          console.error(
            `❌ Lỗi giới hạn lưu lượng ${this.provider.toUpperCase()} API (Rate Limit / Quota Exceeded): ${msg}`
          );
        } else if (isServerOverloaded) {
          console.error(
            `❌ Lỗi máy chủ ${this.provider.toUpperCase()} quá tải (${status}): Vui lòng thử lại sau giây lát hoặc đổi AI_MODEL trong .env.`
          );
        } else {
          console.error(`❌ Lỗi AI API (${this.provider}):`, msg || error);
        }
        return { ok: false, rawOutput: msg || String(error) };
      }
    }
    return { ok: false, rawOutput: "AI API request failed after retry attempts." };
  }
}
