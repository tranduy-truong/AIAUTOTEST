import fs from "fs";
import path from "path";
import { OpenAIAdapter } from "../../adapters/openai.js";
import { PlaywrightMcpClient } from "../../core/mcp/playwright-client.js";
import { section, detail, success, warning, error as uiError, artifact } from "../../core/cli-ui.js";
import { fixCommonPlaywrightIssues } from "../generator/run.js";

export interface AgenticMcpOptions {
  mode: "generator" | "healer";
  targetUrl?: string;
  maxSteps?: number;
  headless?: boolean;
  credentials?: {
    username?: string;
    password?: string;
  };
}

export interface AgenticMcpResult {
  ok: boolean;
  generatedFiles?: string[];
  stepsExecuted: number;
  error?: string;
}

/**
 * Đọc system prompt từ file .github/agents/*.agent.md
 */
function loadAgentSystemPrompt(agentName: "playwright-test-generator" | "playwright-test-healer"): string {
  const filePath = path.join(process.cwd(), ".github", "agents", `${agentName}.agent.md`);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf-8");
    // Bỏ qua phần YAML frontmatter ở đầu file
    return content.replace(/^---[\s\S]*?---\n*/, "").trim();
  }
  return "You are an expert Playwright Automation Engineer.";
}

/**
 * Khởi chạy vòng lặp Agentic MCP (Interactive Tool Calling)
 */
export async function runAgenticMcpLoop(options: AgenticMcpOptions): Promise<AgenticMcpResult> {
  const mode = options.mode;
  const maxSteps = options.maxSteps ?? 15;
  const headless = options.headless ?? false; // Mặc định mở browser trực quan để người dùng theo dõi
  const targetUrl = options.targetUrl || "https://hcm.mobifone.vn/qly-dttg/dang-nhap";

  section("03b", "Agentic MCP Runner", `Playwright MCP Server • Điều khiển trực tiếp (${mode.toUpperCase()})`);

  console.log(`\n🚀 [MCP] Đang khởi động Playwright MCP Server (${headless ? "Headless" : "Headed"})...`);
  const mcpClient = new PlaywrightMcpClient();

  try {
    await mcpClient.connect({ headless });
    success("Đã kết nối với Playwright MCP Server thành công.");
  } catch (err: any) {
    uiError(`Không thể khởi động Playwright MCP Server: ${err.message}`);
    return { ok: false, stepsExecuted: 0, error: err.message };
  }

  const adapter = new OpenAIAdapter();
  detail("AI Provider", adapter.provider.toUpperCase());
  detail("AI Model", adapter.model);

  try {
    const tools = await mcpClient.getOpenAITools();
    console.log(`🛠️  [MCP] Đã nạp ${tools.length} công cụ từ Playwright MCP Server.`);

    const agentName = mode === "generator" ? "playwright-test-generator" : "playwright-test-healer";
    const systemPrompt = loadAgentSystemPrompt(agentName);

    const initialUserPrompt = mode === "generator"
      ? `Hãy mở URL: ${targetUrl}.
Khám phá giao diện bằng các công cụ browser_* (navigate, snapshot, click, type...).
${options.credentials ? `Thông tin đăng nhập nếu cần: Username = '${options.credentials.username}', Password = '${options.credentials.password}'` : ''}
Sau khi khám phá các phần tử và chức năng, hãy viết mã test Playwright TypeScript hoàn chỉnh cho các kịch bản kiểm thử của trang này.`
      : `Hãy kiểm tra các test case bị lỗi bằng công cụ test_run / test_debug và phân tích sửa lỗi.`;

    const messages: any[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: initialUserPrompt },
    ];

    let step = 0;
    let completed = false;
    let generatedCode = "";

    while (step < maxSteps && !completed) {
      step++;
      console.log(`\n🤖 [Vòng lặp Agent] Bước ${step}/${maxSteps}...`);

      // ── Throttling Delay: Tạm dừng 2.5s giữa các bước để tránh lỗi 429 Rate Limit ──
      if (step > 1) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }

      // ── Gọi AI với cơ chế Auto-Retry khi gặp lỗi 429 ──
      let response: any = null;
      let retries = 3;
      while (retries > 0) {
        try {
          response = await adapter.client.chat.completions.create({
            model: adapter.model,
            messages,
            tools: tools.length > 0 ? (tools as any) : undefined,
            tool_choice: "auto",
            temperature: 0.2,
          });
          break; // Thành công
        } catch (apiErr: any) {
          if (apiErr.status === 429 || /429|rate limit|too many requests/i.test(apiErr.message || '')) {
            retries--;
            console.warn(`⏳ [Rate Limit 429] Đang chờ 30 giây trước khi thử lại (Còn ${retries} lần)...`);
            await new Promise((resolve) => setTimeout(resolve, 30000));
          } else {
            throw apiErr;
          }
        }
      }

      if (!response) {
        throw new Error("Không nhận được phản hồi từ AI sau nhiều lần thử lại do Rate Limit (429).");
      }

      const choice = response.choices[0];
      if (!choice || !choice.message) {
        warning("AI không trả về phản hồi.");
        break;
      }

      const aiMessage = choice.message;
      messages.push(aiMessage);

      // Nếu AI có lời thoại / suy nghĩ
      if (aiMessage.content) {
        console.log(`💬 [AI]: ${aiMessage.content.slice(0, 300)}${aiMessage.content.length > 300 ? "..." : ""}`);
        
        // Kiểm tra xem AI đã xuất code test trong nội dung text chưa
        const codeMatch = aiMessage.content.match(/```(?:typescript|ts)?\s*([\s\S]*?)```/);
        if (codeMatch && codeMatch[1].includes("test(") && codeMatch[1].includes("expect(")) {
          generatedCode = codeMatch[1].trim();
        }
      }

      // Xử lý các yêu cầu gọi Tool (Tool Calls)
      if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
        for (const toolCall of aiMessage.tool_calls) {
          const functionName = toolCall.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch {
            args = {};
          }

          console.log(`⚙️  [Tool Call] Gọi tool: \x1b[36m${functionName}\x1b[0m(${JSON.stringify(args).slice(0, 100)})`);
          let toolResult = await mcpClient.callTool(functionName, args);

          const resultSnippet = toolResult.length > 250 ? toolResult.slice(0, 250) + " ... [đã rút gọn]" : toolResult;
          console.log(`   ↳ Kết quả: ${resultSnippet.replace(/[\r\n]+/g, " ")}`);

          // Nếu AI gọi tool ghi test generator_write_test
          if (functionName === "generator_write_test" || functionName.includes("write_test")) {
            if (typeof (args as any).content === "string" || typeof (args as any).code === "string") {
              generatedCode = ((args as any).content || (args as any).code || "").trim();
              completed = true;
            }
          }

          // Rút gọn snapshot để không làm phình context tokens
          if (toolResult.length > 4000) {
            toolResult = toolResult.slice(0, 4000) + "\n... [Snapshot DOM đã được rút gọn để tiết kiệm token]";
          }

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolResult,
          });
        }
      } else {
        // AI không gọi thêm tool nào -> Có thể đã hoàn tất
        if (generatedCode) {
          completed = true;
        } else {
          console.log("   AI đã hoàn thành phân tích.");
          break;
        }
      }
    }

    // ── BƯỚC TỔNG HỢP & XUẤT CODE TEST CUỐI CÙNG (NẾU CHƯA CÓ CODE) ──
    if (!generatedCode) {
      console.log("\n📝 [MCP Agent] Đang tổng hợp nhật ký tương tác và xuất file mã test Playwright...");
      let mcpLogs = "";
      try {
        mcpLogs = await mcpClient.callTool("generator_read_log", {});
      } catch {}

      const finalPrompt = `Dựa vào toàn bộ quá trình tương tác với trình duyệt và các hành động đã ghi nhận ở trên:
${mcpLogs ? `[NHẬT KÝ HÀNH ĐỘNG ĐÃ THỰC HIỆN TỪ PLAYWRIGHT MCP]:\n${mcpLogs}\n` : ''}
Hãy viết file mã test Playwright TypeScript (.spec.ts) hoàn chỉnh cho kịch bản kiểm thử vừa thực hiện.
Bắt buộc có đầy đủ các bước: mở trang, đăng nhập nếu cần, thực hiện các thao tác trên form/bảng, và assertions kiểm tra kết quả (sử dụng .first() cho text assertions).
Toàn bộ code nằm trong một khối \`\`\`typescript ... \`\`\`.`;

      try {
        messages.push({ role: "user", content: finalPrompt });
        const finalRes = await adapter.client.chat.completions.create({
          model: adapter.model,
          messages,
          temperature: 0.2,
        });
        const finalContent = finalRes.choices[0]?.message?.content || "";
        const codeMatch = finalContent.match(/```(?:typescript|ts)?\s*([\s\S]*?)```/);
        if (codeMatch) {
          generatedCode = codeMatch[1].trim();
        } else if (finalContent.includes("test(") && finalContent.includes("expect(")) {
          generatedCode = finalContent.trim();
        }
      } catch (err: any) {
        warning(`Không thể xuất code tổng hợp tự động: ${err.message}`);
      }
    }

    // Lưu file test nếu có code được sinh ra
    const savedFiles: string[] = [];
    if (generatedCode) {
      const outDir = path.join(process.cwd(), "tests", "e2e");
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      let cleanCode = fixCommonPlaywrightIssues(generatedCode);
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
      const fileName = `agentic_mcp_${timestamp}.spec.ts`;
      const filePath = path.join(outDir, fileName);

      fs.writeFileSync(filePath, cleanCode + "\n", "utf-8");
      savedFiles.push(filePath);
      success(`Đã sinh code test thành công qua Playwright MCP Server!`);
      artifact("File test E2E", filePath);
    } else {
      warning("Chưa có đoạn mã test nào được tạo sau phiên Agentic MCP.");
    }

    return {
      ok: true,
      generatedFiles: savedFiles,
      stepsExecuted: step,
    };
  } catch (error: any) {
    uiError(`Lỗi trong vòng lặp Agentic MCP: ${error.message}`);
    return { ok: false, stepsExecuted: 0, error: error.message };
  } finally {
    console.log("\n🔌 [MCP] Đang đóng kết nối Playwright MCP Server...");
    await mcpClient.disconnect();
    success("Đã hoàn tất phiên Agentic MCP.");
  }
}
