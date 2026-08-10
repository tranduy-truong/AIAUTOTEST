import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { OpenAIAdapter } from "../../adapters/openai.js";
//import { OllamaAdapter } from "../../adapters/ollama.js";

// Lấy đường dẫn thư mục hiện tại của file run.ts
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runPlanner(
  level: "unit" | "integration" | "e2e",
  contextData: string,
) {
  console.log(
    `\n🧠 [Planner Agent] Đang lập kế hoạch kiểm thử cho tầng: ${level.toUpperCase()}`,
  );

  // 1. ĐỌC PROMPT TỪ FILE .md CỦA BẠN THAY VÌ HARDCODE
  const promptFileName = `prompt-${level}.md`;
  const promptFilePath = path.join(__dirname, promptFileName);

  let systemPrompt = "";
  if (fs.existsSync(promptFilePath)) {
    systemPrompt = fs.readFileSync(promptFilePath, "utf-8");
  } else {
    console.error(`❌ Không tìm thấy file kịch bản: ${promptFilePath}`);
    console.log(`👉 Bạn cần tạo file này chứa luật cho AI trước khi chạy!`);
    return false;
  }

  // 2. Ghép kịch bản (systemPrompt) với dữ liệu thực tế (contextData)
  const taskContent = `
${systemPrompt}

---
⚠️ LƯU Ý QUAN TRỌNG: Phần "Ví dụ" ở trên chỉ là THAM KHẢO ĐỊNH DẠNG. 
TUYỆT ĐỐI KHÔNG dùng URL, dữ liệu, hay tên trang web trong ví dụ đó.
Bạn PHẢI sử dụng ĐÚNG thông tin thực tế từ mục [THÔNG TIN THỰC TẾ CỦA NGƯỜI DÙNG] bên dưới.
---

[THÔNG TIN THỰC TẾ CỦA NGƯỜI DÙNG - ĐÂY LÀ MỤC TIÊU THẬT SỰ]
URL / Tính năng cần kiểm thử: ${contextData}

[YÊU CẦU ĐẦU RA]
- Sinh test case dựa 100% trên URL/tính năng "${contextData}" ở trên.
- KHÔNG sử dụng bất kỳ thông tin nào từ ví dụ minh họa (saucedemo, standard_user, secret_sauce, v.v.).
- Chỉ xuất ra mảng JSON hợp lệ chứa các test case. KHÔNG GIẢI THÍCH GÌ THÊM.
  `;

  // ... (Phần code bên dưới giữ nguyên như cũ: tạo workDir, gọi adapter, xuất file JSON)
  const runId = `run_${Date.now()}`;
  const workDir = path.join(process.cwd(), ".testkit", "runs", runId);
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, "task.md"), taskContent.trim());

  const adapter = new OpenAIAdapter("llama-3.3-70b-versatile");

  const result = await adapter.run({
    promptDir: workDir,
    workDir,
    timeoutMs: 120000,
  });
  //const adapter = new OllamaAdapter("qwen2.5-coder");
  //const result = await adapter.run({
  //  promptDir: workDir,
  // workDir,
  // timeoutMs: 120000,
  //});

  if (result.ok) {
    const jsonMatch = result.rawOutput.match(/\[[\s\S]*\]/);
    const jsonContent = jsonMatch ? jsonMatch[0] : result.rawOutput;

    if (!fs.existsSync("artifacts")) fs.mkdirSync("artifacts");
    fs.writeFileSync(`artifacts/test-plan-${level}.json`, jsonContent);

    console.log(
      `✅ Đã lập xong kế hoạch! Lưu tại: artifacts/test-plan-${level}.json`,
    );
    return true;
  } else {
    console.error(`❌ Lỗi khi Planner chạy:`, result.rawOutput);
    return false;
  }
}
