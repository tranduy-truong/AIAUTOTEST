import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { OpenAIAdapter } from "../../adapters/openai.js";
//import { OllamaAdapter } from "../../adapters/ollama.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runHealer(
  level: "unit" | "integration" | "e2e",
  errorLog: string,
) {
  console.log(
    `\n🩺 [Healer Agent] Đang chẩn đoán lỗi cho tầng: ${level.toUpperCase()}`,
  );

  const promptFileName = `prompt-${level}.md`;
  const promptFilePath = path.join(__dirname, promptFileName);

  let systemPrompt = "";
  if (fs.existsSync(promptFilePath)) {
    systemPrompt = fs.readFileSync(promptFilePath, "utf-8");
  } else {
    console.error(
      `❌ Không tìm thấy file kịch bản của Healer: ${promptFilePath}`,
    );
    return false;
  }

  console.log(
    "🛠️ Tính năng Healer chuyên sâu đang được cấu hình thêm. Hiện tại CLI sẽ dùng Policy Harness để chẩn đoán.",
  );
  return true;
}
