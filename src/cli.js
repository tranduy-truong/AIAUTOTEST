import inquirer from "inquirer";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { TestPolicyHarness } from "./harness/policy.js";

import { runPlanner } from "./agents/planner/run.js";
import { runGenerator } from "./agents/generator/run.js";
import { runCrawler } from "./agents/crawler/run.js";
import { parseScript } from "./core/step-parser.js";
import { runLive } from "./agents/crawler/live-runner.js";
import { buildActionPlan, generateSpecFromActionPlan } from "./core/action-plan.js";

const harness = new TestPolicyHarness();

// 1. MENU CHÍNH CỦA ỨNG DỤNG
async function mainMenu() {
  console.clear();
  console.log(`
======================================================
AI TESTING TOOLKIT - 3 TẦNG KIỂM THỬ THÔNG MINH
======================================================
  `);

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "Mời bạn chọn tính năng:",
      choices: [
        {
          name: "1. AI Lên kế hoạch & Sinh Code Test (Planner -> Generator)",
          value: "plan_and_generate",
        },
        {
          name: "2. Chạy kiểm thử E2E (Playwright - Giao diện)",
          value: "run_e2e",
        },
        {
          name: "3. Chạy kiểm thử Integration (Tích hợp API/DB)",
          value: "run_integration",
        },
        {
          name: "4. Chạy kiểm thử Unit Test (Vitest - Logic nội bộ)",
          value: "run_unit",
        },
        {
          name: "5. Xem báo cáo kiểm thử gần nhất",
          value: "view_report",
        },
        { name: "6. Thoát ứng dụng", value: "exit" },
      ],
    },
  ]);

  switch (action) {
    case "plan_and_generate":
      await handlePlanAndGenerate();
      break;
    case "run_e2e":
      await runTests("e2e");
      break;
    case "run_integration":
      await runTests("integration");
      break;
    case "run_unit":
      await runTests("unit");
      break;
    case "view_report":
      showReport();
      break;
    case "exit":
      process.exit(0);
  }
}

// 2. TÍNH NĂNG: GỌI PLANNER LÊN KẾ HOẠCH & GENERATOR SINH CODE
async function handlePlanAndGenerate() {
  // Chọn tầng kiểm thử
  const { level } = await inquirer.prompt([
    {
      type: "list",
      name: "level",
      message: "Bạn muốn sinh test case cho tầng nào?",
      choices: [
        { name: "E2E (Kiểm thử luồng giao diện - Blackbox)", value: "e2e" },
        {
          name: "Integration (Kiểm thử API/Tích hợp - Greybox)",
          value: "integration",
        },
        {
          name: "Unit (Kiểm thử hàm/component nội bộ - Whitebox)",
          value: "unit",
        },
      ],
    },
  ]);

  // Cấp Context (Dữ liệu đầu vào) tùy theo tầng
  let contextData = "";
  if (level === "e2e") {
    console.log(`
-----------------------------------------------------------------
NHAP KICH BAN TEST

Viet tung test case bang tieng Viet, AI se dich sang code.
Moi dong la 1 buoc, AI chuyen doi 1:1 sang Playwright.

Vi du:
  URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap
  TC_01: Dang nhap thanh cong
  - Mo URL
  - Nhap 'admin' vao o 'Nhap ten dang nhap'
  - Nhap '123123' vao o 'Nhap mat khau'
  - Bam nut 'Dang nhap'
  - Kiem tra: URL khong con chua 'dang-nhap'
-----------------------------------------------------------------
    `);

    const { scriptContent } = await inquirer.prompt([
      {
        type: "editor",
        name: "scriptContent",
        message:
          "Nhap kich ban test chi tiet (mo editor, luu va dong khi xong):",
      },
    ]);

    // === CRAWLER: Live Multi-State Crawler (vấn đáp DOM nhiều lần theo từng trạng thái) ===
    let crawledDomSection = "";
    console.log("\n[Crawler Agent] Dang khoi chay Live Crawler de van dap DOM theo tung trang thai...");
    try {
      const parsedCases = parseScript(scriptContent);
      const snapshotsMap = await runLive(parsedCases);

      let domReport = "# Multi-State Crawled DOM Data\n\n";
      let totalSnapshots = 0;
      for (const [tcId, snapshots] of snapshotsMap) {
        domReport += `## ${tcId} DOM Snapshots\n\n`;
        for (const snap of snapshots) {
          totalSnapshots++;
          domReport += `### State: ${snap.afterStep} (URL: ${snap.url})\n`;
          domReport += `| Tag | Type | Role | Name | Placeholder | Label | Text |\n`;
          domReport += `| --- | ---- | ---- | ---- | ----------- | ----- | ---- |\n`;
          snap.elements.forEach(el => {
            if (el.isVisible) {
              domReport += `| ${el.tag} | ${el.type || ''} | ${el.role || ''} | ${el.name || ''} | ${el.placeholder || ''} | ${el.ariaLabel || ''} | ${el.text ? el.text.slice(0, 50) : ''} |\n`;
            }
          });
          domReport += "\n";
        }
      }

      if (!fs.existsSync("artifacts")) fs.mkdirSync("artifacts");
      fs.writeFileSync("artifacts/crawled-dom.md", domReport);
      console.log(`   Da van dap va thu thap ${totalSnapshots} DOM snapshot(s) theo tung trang thai.`);
      crawledDomSection = `\n\n[DU LIEU DOM THUC TE DA CRAWL THEO TUNG TRANG THAI NGHIEP VU]\nKhi buoc test mo ta phan tu, hay TRA CUU DOM ben duoi de tim selector va role chinh xac.\n${domReport}`;
    } catch (err) {
      console.log(`   Warning: Live Crawler gap loi (khong anh huong kich ban): ${err.message}`);
    }

    contextData = `[CHẾ ĐỘ KỊCH BẢN CHI TIẾT - SCRIPT MODE]
QUAN TRỌNG: Người dùng đã viết kịch bản test CHI TIẾT TỪNG BƯỚC. 
AI PHẢI chuyển đổi CHÍNH XÁC 1:1 từng bước sang code Playwright.
TUYỆT ĐỐI KHÔNG được tự thêm, bớt hoặc thay đổi bất kỳ bước nào.
Khi gặp mô tả mơ hồ (VD: "icon con mắt", "nút ẩn/hiện"), tra cứu dữ liệu DOM bên dưới để tìm selector chính xác.
Nếu không tìm thấy trong DOM, dùng selector tổng quát nhất có thể (VD: button gần ô input password).

Quy tắc chuyển đổi:
- "Mở URL" hoặc "Mở trang ..." → await page.goto(URL)
- "Nhập 'X' vào ô 'Y'" → await page.getByPlaceholder('Y').fill('X')
- "Nhập 'X' vào label 'Y'" → await page.getByLabel('Y').fill('X')
- "Bỏ trống ô 'Y'" → không gọi fill() cho ô đó
- "Bấm nút 'Z'" → await page.getByRole('button', { name: 'Z' }).or(page.getByText('Z')).first().click()
- "Click vào 'Z'" → await page.getByText('Z').first().click()
- "Bấm vào icon ..." → tra cứu DOM để tìm button/svg gần nhất, dùng locator('.class-name').first().click()
- "Kiểm tra: hiển thị text 'W'" hoặc "Kiểm tra: Có thông báo 'W'" → await expect(page.getByText('W')).toBeVisible()
- "Kiểm tra: Có cả 2 thông báo 'A' và 'B'" → 2 dòng expect riêng biệt
- "Kiểm tra: URL không còn chứa 'X'" → await expect(page).not.toHaveURL(/.*X.*/i)
- "Kiểm tra: URL chứa 'X'" → await expect(page).toHaveURL(/.*X.*/i)
- "Kiểm tra: Mật khẩu dạng ẩn" → await expect(page.getByPlaceholder('Nhập mật khẩu')).toHaveAttribute('type', 'password')
- "Kiểm tra: Mật khẩu dạng văn bản" → await expect(page.getByPlaceholder('Nhập mật khẩu')).toHaveAttribute('type', 'text')
- "Chờ trang load xong" → await page.waitForLoadState('networkidle')

=== KỊCH BẢN TEST CỦA NGƯỜI DÙNG ===
${scriptContent}
=== HẾT KỊCH BẢN ===${crawledDomSection}`;

  } else if (level === "integration") {
    const { apiDesc } = await inquirer.prompt([
      {
        type: "input",
        name: "apiDesc",
        message: "Nhập Endpoint API hoặc dán cấu trúc JSON/Swagger vào đây:",
      },
    ]);
    contextData = apiDesc;
  } else if (level === "unit") {
    const { filePath } = await inquirer.prompt([
      {
        type: "input",
        name: "filePath",
        message: "Nhập đường dẫn file code cần test (VD: src/lib/discount.ts):",
      },
    ]);
    if (fs.existsSync(filePath)) {
      contextData = fs.readFileSync(filePath, "utf-8"); // Đọc luôn code đưa cho AI
    } else {
      console.log("File không tồn tại, AI sẽ dùng đường dẫn dự đoán.");
      contextData = filePath;
    }
  }

  // Bước 1: Gọi Planner
  const isPlanSuccess = await runPlanner(level, contextData);

  if (isPlanSuccess) {
    const { confirmGen } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmGen",
        message: `Đã có Test Plan (${level}). Kích hoạt Generator sinh code luôn không?`,
        default: true,
      },
    ]);

    // Bước 2: Gọi Generator
    if (confirmGen) {
      let targetName = "";

      // Tự động tìm URL trong contextData (cả ở Auto Mode lẫn Script Mode)
      const urlMatch = contextData.match(/https?:\/\/[^\s\'"\)>]+/i);
      if (urlMatch) {
        try {
          const urlObj = new URL(urlMatch[0]);
          let host = urlObj.hostname.replace(/^www\./, "").split(".")[0];
          if (host === "opensource-demo") host = "orangehrm";
          const pathParts = urlObj.pathname.split("/").filter(Boolean);
          const lastPath = pathParts.pop() || "main";
          targetName = `${host}_${lastPath}`
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "_");
        } catch {}
      }

      // Nếu không có URL, tìm tên Module / TC đầu tiên
      if (!targetName) {
        const tcMatch = contextData.match(/TC_([A-Z0-9_]+)/i);
        if (tcMatch) {
          const moduleName = tcMatch[1].split("_")[0].toLowerCase();
          targetName = `${level}_${moduleName}`;
        }
      }

      if (!targetName) {
        targetName = `${level}_test_suite`;
      }

      await runGenerator(level, targetName);
    }
  }

  await returnToMenu();
}

// 3. TÍNH NĂNG: CHẠY TEST VÀ KÍCH HOẠT CHÍNH SÁCH BẮT LỖI
async function runTests(level) {
  console.log(
    `\nĐang khởi chạy bộ kiểm thử cấp độ [${level.toUpperCase()}]...`,
  );

  // Xác định lệnh chạy theo tầng
  let command = "";
  if (level === "e2e") command = "npx playwright test";
  else if (level === "integration")
    command = "npx vitest run tests/integration";
  else if (level === "unit") command = "npx vitest run tests/unit";

  try {
    const output = execSync(command, { encoding: "utf-8" });
    console.log(output);
    console.log(
      `\nTất cả kịch bản test [${level.toUpperCase()}] đã pass thành công!`,
    );
  } catch (error) {
    console.log("\nPhát hiện lỗi trong quá trình run test!");
    console.log("Kích hoạt AI Diagnostics & Policy Harness...");

    const errorMessage = error.stdout || error.message;
    const result = await harness.handleTestFailure(
      level,
      `Suite [${level}]`,
      errorMessage,
    );

    if (!fs.existsSync("artifacts")) fs.mkdirSync("artifacts");

    const reportContent = `
# BÁO CÁO PHÂN TÍCH LỖI TỰ ĐỘNG - ${new Date().toLocaleString()}

- **Cấp độ test**: ${level.toUpperCase()}
- **Chế độ áp dụng**: ${result.mode}
- **Hành động hệ thống**: ${result.actionTaken}

---

## Log lỗi gốc từ Playwright:

\`\`\`
${result.rawErrorLog || errorMessage}
\`\`\`

---

## Phân tích & Đề xuất sửa lỗi từ AI:

${result.report}
    `;

    fs.writeFileSync("artifacts/report.md", reportContent);
    console.log(
      "\nĐã xuất báo cáo chi tiết nguyên nhân vào file: artifacts/report.md",
    );
  }

  await returnToMenu();
}

// 4. TÍNH NĂNG: XEM BÁO CÁO CẬP NHẬT
function showReport() {
  if (fs.existsSync("artifacts/report.md")) {
    const content = fs.readFileSync("artifacts/report.md", "utf-8");
    console.log("\n------------------ BÁO CÁO GẦN NHẤT ------------------");
    console.log(content);
    console.log("------------------------------------------------------\n");
  } else {
    console.log(
      "\nChưa có báo cáo nào được ghi nhận trong thư mục artifacts/\n",
    );
  }
  returnToMenu();
}

// HÀM PHỤ TỰ QUAY LẠI MENU
async function returnToMenu() {
  await inquirer.prompt([
    {
      type: "input",
      name: "continue",
      message: "\nNhấn [ENTER] để quay lại Menu chính...",
    },
  ]);
  await mainMenu();
}

// KHỞI CHẠY MENU
mainMenu();
