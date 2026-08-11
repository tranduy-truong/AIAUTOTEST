import inquirer from "inquirer";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { TestPolicyHarness } from "./harness/policy.js";

import { loadStructuredE2EPlan, runPlanner } from "./agents/planner/run.js";
import { runGenerator } from "./agents/generator/run.js";
import { runHealer } from "./agents/healer/run.js";
import { plannerPlanToTestCases } from "./agents/planner/schema.js";
import { buildActionPlan } from "./core/action-plan.js";
import { buildCompactDomReport, runLive } from "./agents/crawler/live-runner.js";
import { analyzeUnitInput, createUnitSession } from "./core/unit/artifacts.js";
import { runLastGeneratedUnitTests } from "./core/unit/runner.js";

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
  let plannerCompleted = false;
  if (level === "e2e") {
    console.log(`
-----------------------------------------------------------------
NHAP KICH BAN TEST

Viet tung test case bang tieng Viet, AI se dich sang code.
Co the viet cau tu nhien gom nhieu thao tac; Planner se tach theo dung thu tu.
Neu cau mo ho, he thong se yeu cau lam ro thay vi doan.

Vi du:
  URL: https://staging.example.com/login
  TC_01: Dang nhap thanh cong
  - Mo URL
  - Nhap 'demo_user' vao o 'Nhap ten dang nhap'
  - Nhap 'demo_password' vao o 'Nhap mat khau'
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

    if (!fs.existsSync("artifacts")) fs.mkdirSync("artifacts");
    fs.writeFileSync("artifacts/source-script-e2e.md", scriptContent.trim() + "\n");

    // Planner là tầng hiểu tiếng Việt duy nhất. JSON đã qua validator mới được
    // chuyển cho Crawler; không còn parse lại bằng regex ở CLI.
    const plannerSuccess = await runPlanner("e2e", scriptContent);
    if (!plannerSuccess) {
      console.error("   Da dung truoc Crawler/Generator vi Planner chua tao duoc Action Intent an toan.");
      await returnToMenu();
      return;
    }
    plannerCompleted = true;

    // === CRAWLER: Live Multi-State Crawler (xác minh DOM theo Action Intent) ===
    console.log("\n[Crawler Agent] Dang khoi chay Live Crawler de xac minh Action Intent tren DOM that...");
    try {
      const parsedCases = plannerPlanToTestCases(loadStructuredE2EPlan());
      const snapshotsMap = await runLive(parsedCases);

      const totalSnapshots = [...snapshotsMap.values()]
        .reduce((total, snapshots) => total + snapshots.length, 0);
      const domReport = buildCompactDomReport(snapshotsMap);

      fs.writeFileSync("artifacts/crawled-dom.md", domReport);
      const actionPlan = buildActionPlan(parsedCases, snapshotsMap);
      const crawlerFailuresPath = "artifacts/crawler-failures.json";
      const crawlerFailures = fs.existsSync(crawlerFailuresPath)
        ? JSON.parse(fs.readFileSync(crawlerFailuresPath, "utf-8"))
        : [];
      const unresolvedActions = actionPlan.testCases.flatMap(testCase =>
        testCase.actions
          .filter(action => action.confidence === "low")
          .map(action => {
            const crawlerFailure = crawlerFailures.find(failure =>
              failure.testCaseId === testCase.id && failure.stepNumber === action.stepIndex,
            ) || crawlerFailures.find(failure =>
              failure.testCaseId === testCase.id &&
              String(failure.reason).startsWith("AUTHENTICATION_FAILED:"),
            );
            return {
              testCaseId: testCase.id,
              stepIndex: action.stepIndex,
              description: action.description,
              matchedBy: action.matchedBy,
              currentUrl: crawlerFailure?.currentUrl,
              crawlerReason: crawlerFailure?.reason,
            };
          }),
      );
      if (unresolvedActions.length > 0) {
        fs.writeFileSync(
          "artifacts/unresolved-actions.json",
          JSON.stringify(unresolvedActions, null, 2) + "\n",
        );
        throw new Error(
          `Crawler chua xac minh duoc ${unresolvedActions.length} action. ` +
          `Lan chay nay da ket thuc, khong tu dong cho hay thu lai. ` +
          `Chi tiet: artifacts/unresolved-actions.json va artifacts/crawler-failures.json. ` +
          `Generator duoc chan de khong doan locator.`,
        );
      }
      console.log(`   Da van dap va thu thap ${totalSnapshots} DOM snapshot(s) theo tung trang thai.`);
    } catch (err) {
      console.error(`   Loi hop dong E2E: ${err.message}`);
      console.error("   Planner Plan van duoc giu lai; Generator dung de tranh sinh locator doan mo.");
      await returnToMenu();
      return;
    }

    contextData = scriptContent;

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
    console.log(`
-----------------------------------------------------------------
UNIT TEST WHITEBOX

Planner se doc AST, xac dinh branch/dependency va lap Test Plan.
Generator chi duoc import source that; khong copy ham vao file test.
-----------------------------------------------------------------
    `);
    const { inputMode } = await inquirer.prompt([
      {
        type: "list",
        name: "inputMode",
        message: "Bạn muốn cung cấp mã nguồn theo cách nào?",
        choices: [
          { name: "Chọn thư mục dự án", value: "folder" },
          { name: "Chọn một file nguồn", value: "file" },
          { name: "Dán đoạn code export để thử nhanh", value: "paste" },
        ],
      },
    ]);
    let unitInputPath = "";
    if (inputMode === "paste") {
      const { pastedCode } = await inquirer.prompt([
        {
          type: "editor",
          name: "pastedCode",
          message: "Dán code JavaScript/TypeScript (target phải có export):",
        },
      ]);
      const snippetDir = path.join(process.cwd(), ".testkit", "unit-inputs", `snippet_${Date.now()}`);
      fs.mkdirSync(snippetDir, { recursive: true });
      unitInputPath = path.join(snippetDir, "snippet.ts");
      fs.writeFileSync(unitInputPath, `${pastedCode.trim()}\n`);
    } else {
      const { sourcePath } = await inquirer.prompt([
        {
          type: "input",
          name: "sourcePath",
          message: inputMode === "folder"
            ? "Nhập đường dẫn thư mục gốc dự án cần test:"
            : "Nhập đường dẫn file nguồn cần test:",
          validate: value => value.trim() ? true : "Đường dẫn không được để trống.",
        },
      ]);
      unitInputPath = path.resolve(sourcePath.trim());
    }

    let analysis;
    try {
      analysis = analyzeUnitInput(unitInputPath);
    } catch (error) {
      console.error(`❌ Code Reader không thể phân tích: ${error.message}`);
      await returnToMenu();
      return;
    }
    const eligibleTargets = analysis.index.targets.filter(target => target.executionMode !== "UNSUPPORTED");
    if (eligibleTargets.length === 0) {
      console.error("❌ Không tìm thấy hàm/class được export để sinh Unit Test.");
      console.error("   Target phải dùng export để test có thể import source thật.");
      await returnToMenu();
      return;
    }
    console.log(`   Code Reader: ${analysis.manifest.sourceFiles.length} file, ${analysis.index.targets.length} target, ${eligibleTargets.length} target có thể test.`);
    console.log(`   Framework phát hiện: ${analysis.manifest.testFramework}`);
    if (analysis.manifest.testFramework === "unknown") {
      console.error("❌ Dự án chưa cấu hình Vitest hoặc Jest. Hệ thống không tự đoán/cài framework.");
      await returnToMenu();
      return;
    }

    let selectedTargetIds = eligibleTargets.map(target => target.id);
    if (eligibleTargets.length > 1) {
      const { selectionMode } = await inquirer.prompt([
        {
          type: "list",
          name: "selectionMode",
          message: "Chọn phạm vi Planner Unit:",
          choices: [
            { name: "Chọn hàm/class cụ thể (khuyến nghị)", value: "choose" },
            { name: `Phân tích tất cả ${eligibleTargets.length} target`, value: "all" },
          ],
        },
      ]);
      if (selectionMode === "choose") {
        const { selected } = await inquirer.prompt([
          {
            type: "checkbox",
            name: "selected",
            message: "Chọn target cần sinh test:",
            pageSize: 20,
            choices: eligibleTargets.map(target => ({
              name: `${target.sourceFile} → ${target.symbol} [${target.executionMode}]`,
              value: target.id,
            })),
            validate: value => value.length > 0 ? true : "Phải chọn ít nhất một target.",
          },
        ]);
        selectedTargetIds = selected;
      }
    }
    const { requirements } = await inquirer.prompt([
      {
        type: "input",
        name: "requirements",
        message: "Yêu cầu nghiệp vụ/expected bổ sung (có thể để trống, không nhập secret):",
      },
    ]);
    try {
      const prepared = createUnitSession(analysis, selectedTargetIds, requirements);
      contextData = JSON.stringify(prepared.context);
      console.log(`   Đã tạo Unit Context: ${prepared.session.contextPath}`);
    } catch (error) {
      console.error(`❌ Không tạo được Unit Context: ${error.message}`);
      await returnToMenu();
      return;
    }
  }

  // Bước 1: Gọi Planner
  const isPlanSuccess = plannerCompleted || await runPlanner(level, contextData);

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

  if (level === "unit") {
    let unitResult;
    try {
      unitResult = runLastGeneratedUnitTests();
    } catch (error) {
      console.error(`❌ Không thể chạy Unit Test gần nhất: ${error.message}`);
      await returnToMenu();
      return;
    }
    console.log(`   Dự án đích: ${unitResult.cwd}`);
    console.log(`   Lệnh: ${unitResult.command.join(" ") || "không có"}`);
    if (unitResult.stdout) console.log(unitResult.stdout);
    if (unitResult.stderr) console.error(unitResult.stderr);
    if (unitResult.ok) {
      console.log("\nTất cả Unit Test đã pass thành công!");
      console.log(unitResult.coverageEnabled
        ? "Coverage đã được bật và lưu trong dự án đích."
        : "Test pass nhưng chưa đo coverage vì dự án đích chưa có coverage provider.");
    } else {
      const errorMessage = `${unitResult.stdout}\n${unitResult.stderr}`.trim();
      console.log("\nUnit Test failed. Healer chỉ chẩn đoán, không tự đổi Expected Result.");
      await runHealer("unit", errorMessage);
      const result = await harness.handleTestFailure("unit", "Generated Unit Suite", errorMessage);
      fs.mkdirSync("artifacts", { recursive: true });
      fs.writeFileSync("artifacts/report.md", result.report);
    }
    await returnToMenu();
    return;
  }

  // Xác định lệnh chạy theo tầng
  let command = "";
  if (level === "e2e") command = "npx playwright test tests/e2e";
  else if (level === "integration")
    command = "npx vitest run tests/integration";

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
    await runHealer(level, String(errorMessage));
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
