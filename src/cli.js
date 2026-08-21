import inquirer from "inquirer";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { TestPolicyHarness } from "./harness/policy.js";
import { createNoAuthSession } from "./core/auth/auth-session.js";
import { captureAuthSession } from "./core/auth/auth-capture.js";

import { loadStructuredE2EPlan, runPlanner } from "./agents/planner/run.js";
import { runGenerator } from "./agents/generator/run.js";
import { runAutoHealGeneratorLoop } from "./agents/generator/auto-heal-loop.js";
import { runUnitGenerator } from "./agents/generator/unit-generator.js";
import { runHealer } from "./agents/healer/run.js";
import { plannerPlanToTestCases } from "./agents/planner/schema.js";
import { buildActionPlan } from "./core/action-plan.js";
import {
  buildCompactDomReport,
  runLive,
} from "./agents/crawler/live-runner.js";
import { runApiTestWizard } from "./core/integration/api/wizard.js";
import {
  analyzeUnitInput,
  createUnitSession,
  loadUnitContext,
  loadUnitSession,
} from "./core/unit/artifacts.js";
import {
  runLastGeneratedUnitTests,
  summarizeUnitRunOutput,
} from "./core/unit/runner.js";
import { evaluateUnitPlanOracleGates } from "./core/unit/oracle/oracle-gate-summary.js";
import { runUnitCoverageGuidedLoop } from "./agents/planner/unit-coverage-loop.js";
import { runIntegrationSandbox } from "./core/integration/sandbox-orchestrator.js";
import {
  applyUnitOracleConfirmations,
  formatExpectedForTester,
  formatInputsForTester,
  humanizeUnitTarget,
  loadPendingUnitOracleRequests,
  parseTesterDataValue,
} from "./core/unit/oracle/oracle-confirmation.js";
import {
  artifact,
  detail,
  error as uiError,
  header,
  menuChoice,
  oracleSummary,
  paint,
  profile,
  section,
  success,
  summary,
  testExecutionSummary,
  warning,
} from "./core/cli-ui.js";

const harness = new TestPolicyHarness();

const CLI_CACHE_PATH = path.resolve("artifacts/cli-cache.json");

function loadCliCache() {
  try {
    if (fs.existsSync(CLI_CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CLI_CACHE_PATH, "utf-8"));
    }
  } catch {}
  return {};
}

function saveCliCache(data) {
  try {
    if (!fs.existsSync("artifacts")) fs.mkdirSync("artifacts", { recursive: true });
    const current = loadCliCache();
    const updated = { ...current, ...data };
    fs.writeFileSync(CLI_CACHE_PATH, JSON.stringify(updated, null, 2), "utf-8");
  } catch {}
}

function loadCurrentUnitOracleGateReport() {
  const session = loadUnitSession();
  const context = loadUnitContext(session);
  const plan = JSON.parse(fs.readFileSync(session.planPath, "utf-8"));
  return evaluateUnitPlanOracleGates(context, plan);
}

// 1. MENU CHÍNH CỦA ỨNG DỤNG
async function mainMenu() {
  console.clear();
  header();

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "Chọn chức năng",
      choices: [
        {
          name: menuChoice(
            "01",
            "E2E Web UI",
            "Tự động khám phá & sinh test Playwright",
          ),
          value: "flow_e2e",
        },
        {
          name: menuChoice(
            "02",
            "API / Integration",
            "Nạp OpenAPI/Swagger → Tự động test & kiểm chứng",
          ),
          value: "flow_api_integration",
        },
        {
          name: menuChoice(
            "03",
            "Unit Test",
            "Đọc source code thật → Sinh & chạy Vitest",
          ),
          value: "flow_unit",
        },
        new inquirer.Separator('  ─── [THỰC THI TEST ĐÃ CÓ (TEST RUNNERS)] ────────────────'),
        {
          name: menuChoice("04", "Chạy E2E Test", "Playwright • tests/e2e"),
          value: "run_e2e",
        },
        {
          name: menuChoice("05", "Chạy Unit Test", "Vitest • tests/unit"),
          value: "run_unit",
        },
        {
          name: menuChoice("06", "Xác nhận kết quả Unit", "Duyệt Oracle cho Unit"),
          value: "review_unit_oracles",
        },
        {
          name: menuChoice("07", "Sinh lại test từ Kế hoạch", "Dùng artifacts/test-plan-*.json"),
          value: "generate_from_plan",
        },
        new inquirer.Separator('  ─── [TIỆN ÍCH HỆ THỐNG] ──────────────────────────────────'),
        {
          name: menuChoice("08", "Xem báo cáo", "Tổng hợp kết quả gần nhất"),
          value: "view_report",
        },
        {
          name: menuChoice("09", "Xóa Cache & Reset dữ liệu", "Xóa Guided Learning cache & artifacts"),
          value: "clear_cache",
        },
        { name: menuChoice("10", "Thoát", "Đóng ứng dụng"), value: "exit" },
      ],
    },
  ]);

  switch (action) {
    case "flow_e2e":
      await handlePlanAndGenerate("e2e");
      break;
    case "flow_api_integration":
      await handleApiIntegrationFlow();
      break;
    case "flow_unit":
      await handlePlanAndGenerate("unit");
      break;
    case "run_e2e":
      await runTests("e2e");
      break;
    case "run_unit":
      await runTests("unit");
      break;
    case "review_unit_oracles":
      await reviewPendingUnitOracles({ askToStart: false });
      await returnToMenu();
      return;
    case "generate_from_plan":
      await handleGenerateFromExistingPlan();
      break;
    case "view_report":
      showReport();
      break;
    case "clear_cache":
      await handleClearCache();
      break;
    case "exit":
      process.exit(0);
  }
}

// ─── TÍNH NĂNG CON: ĐIỀU HƯỚNG TẦNG API & INTEGRATION ─────────────────────────
async function handleApiIntegrationFlow() {
  const { mode } = await inquirer.prompt([
    {
      type: "list",
      name: "mode",
      message: "Chọn phương thức kiểm thử API / Integration:",
      choices: [
        {
          name: "📋 OpenAPI / Swagger Contract Test (Khuyến nghị — Nạp file/URL & tự động test ngay)",
          value: "wizard",
        },
        {
          name: "📝 AI Integration Scenario Planner (Nhập kịch bản nghiệp vụ bằng lời văn tự nhiên)",
          value: "ai_planner",
        },
        {
          name: "📦 Database Sandbox Runner (Chạy test tích hợp trong môi trường Sandbox)",
          value: "sandbox",
        },
        new inquirer.Separator(),
        {
          name: "⬅️  Quay lại Menu chính",
          value: "back",
        },
      ],
    },
  ]);

  if (mode === "back") {
    await mainMenu();
    return;
  }

  if (mode === "wizard") {
    await runApiTestWizard();
    await returnToMenu();
  } else if (mode === "ai_planner") {
    await handlePlanAndGenerate("integration");
  } else if (mode === "sandbox") {
    await runTests("integration");
  }
}

async function handleClearCache() {
  console.log("\n🧹 [Dọn dẹp Cache] Đang xóa toàn bộ Guided Learning cache và dữ liệu tạm...");
  const pathsToClean = [
    ".testkit",
    "test-results",
    "artifacts/action-plan.json",
    "artifacts/crawled-dom.md",
    "artifacts/discovery-dom.md",
    "artifacts/discovery-dom.json",
    "artifacts/locator-registry.json",
  ];

  let cleanedCount = 0;
  for (const p of pathsToClean) {
    if (fs.existsSync(p)) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
        cleanedCount++;
      } catch {}
    }
  }

  console.log(`✅ Đã xóa sạch ${cleanedCount} mục cache thành công! Lần quét tiếp theo sẽ khám phá DOM mới hoàn toàn.`);
  await returnToMenu();
}

// 2. TÍNH NĂNG: SINH CODE TEST TRỰC TIẾP TỪ KẾ HOẠCH CÓ SẴN (TEST PLAN)
async function handleGenerateFromExistingPlan() {
  const { level } = await inquirer.prompt([
    {
      type: "list",
      name: "level",
      message: "Bạn muốn sinh code test từ kế hoạch của tầng nào?",
      choices: [
        { name: "E2E (Kiểm thử giao diện - artifacts/test-plan-e2e.json)", value: "e2e" },
        { name: "Integration (Kiểm thử API - artifacts/test-plan-integration.json)", value: "integration" },
        { name: "Unit (Kiểm thử Unit - artifacts/test-plan-unit.json)", value: "unit" },
        new inquirer.Separator(),
        { name: "⬅️  Quay lại Menu chính", value: "back" },
      ],
    },
  ]);

  if (level === "back") {
    await mainMenu();
    return;
  }

  const planPath = `artifacts/test-plan-${level}.json`;
  if (!fs.existsSync(planPath)) {
    console.error(`\n❌ Không tìm thấy file kế hoạch: ${planPath}`);
    console.error(`   Vui lòng chọn chức năng "01 Lên kế hoạch & sinh test" trước để tạo kế hoạch.`);
    await returnToMenu();
    return;
  }

  let planSummary = "";
  let targetName = "";
  try {
    const rawPlan = fs.readFileSync(planPath, "utf-8");
    const planObj = JSON.parse(rawPlan);
    if (level === "e2e") {
      const tcCount = planObj.testCases?.length || 0;
      const stepCount = (planObj.testCases || []).reduce((sum, tc) => sum + (tc.steps?.length || 0), 0);
      const firstUrl = planObj.testCases?.[0]?.url || planObj.testCases?.[0]?.steps?.find(s => s.type === "goto")?.url;
      planSummary = `${tcCount} test cases, ${stepCount} bước${firstUrl ? ` (URL: ${firstUrl})` : ''}`;
      if (firstUrl) {
        try {
          const urlObj = new URL(firstUrl);
          let host = urlObj.hostname.replace(/^www\./, "").split(".")[0];
          if (host === "opensource-demo") host = "orangehrm";
          const pathParts = urlObj.pathname.split("/").filter(Boolean);
          const lastPath = pathParts.pop() || "main";
          targetName = `${host}_${lastPath}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
        } catch {}
      }
      if (!targetName && planObj.testCases?.[0]?.id) {
        targetName = `${level}_${planObj.testCases[0].id.toLowerCase()}`;
      }
    } else if (level === "unit") {
      const targetCount = planObj.targets?.length || 0;
      planSummary = `${targetCount} target(s)`;
      targetName = `unit_test_suite`;
    } else {
      planSummary = `JSON plan hợp lệ`;
      targetName = `integration_test_suite`;
    }
  } catch (err) {
    console.error(`\n❌ File kế hoạch ${planPath} bị lỗi định dạng JSON: ${err.message}`);
    await returnToMenu();
    return;
  }

  if (!targetName) {
    targetName = `${level}_test_suite`;
  }

  console.log(`\n📋 [Kế hoạch tìm thấy] ${planPath} (${planSummary})`);

  const { customTarget } = await inquirer.prompt([
    {
      type: "input",
      name: "customTarget",
      message: "Tên file test đích (Enter để giữ mặc định):",
      default: targetName,
    },
  ]);

  const finalTarget = customTarget.trim() || targetName;

  await runAutoHealGeneratorLoop(level, { targetFile: finalTarget });
  if (level === "unit") {
    await reviewPendingUnitOracles({ askToStart: true });
  }

  await returnToMenu();
}

// 3. TÍNH NĂNG: GỌI PLANNER LÊN KẾ HOẠCH & GENERATOR SINH CODE
async function handlePlanAndGenerate(forcedLevel) {
  let level = forcedLevel;
  if (!level) {
    const res = await inquirer.prompt([
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
          new inquirer.Separator(),
          { name: "⬅️  Quay lại Menu chính", value: "back" },
        ],
      },
    ]);
    if (res.level === "back") {
      await mainMenu();
      return;
    }
    level = res.level;
  }

  // Cấp Context (Dữ liệu đầu vào) tùy theo tầng
  let contextData = "";
  let plannerCompleted = false;
  if (level === "e2e") {
    // ─── Chọn chế độ E2E ─────────────────────────────────────────────
    const { e2eMode } = await inquirer.prompt([{
      type: 'list',
      name: 'e2eMode',
      message: 'Chọn chế độ lập kế hoạch E2E:',
      choices: [
        { name: '🔍 Tự động khám phá & sinh kịch bản (Discovery Mode)', value: 'discovery' },
        { name: '📝 Nhập kịch bản test thủ công (Script Mode)', value: 'script' },
        new inquirer.Separator(),
        { name: '⬅️  Quay lại Menu chính', value: 'back' },
      ],
    }]);

    if (e2eMode === 'back') {
      await mainMenu();
      return;
    }

    if (e2eMode === 'discovery') {
      // ═══════════════════════════════════════════════════════════════
      // DISCOVERY MODE: Crawler tự quét đa trang → AI Planner sinh TC
      // ═══════════════════════════════════════════════════════════════

      // 1. Hỏi URL gốc cần quét (sử dụng cache lần trước làm mặc định)
      const cliCache = loadCliCache();
      const { seedUrlsRaw } = await inquirer.prompt([
        {
          type: 'input',
          name: 'seedUrlsRaw',
          message: 'Nhập URL gốc cần quét (hoặc nhiều URL cách nhau bằng dấu phẩy):',
          default: cliCache.lastSeedUrls || 'https://practicesoftwaretesting.com',
          validate: (v) => (v && v.trim() ? true : 'Bắt buộc nhập URL.'),
        },
      ]);
      const seedUrls = seedUrlsRaw
        .split(/[,;\r\n]+/)
        .map(line => line.trim())
        .filter(line => line.startsWith('http'));
      if (seedUrls.length === 0) {
        console.error('❌ Không có URL hợp lệ nào. Vui lòng nhập ít nhất 1 URL bắt đầu bằng http/https.');
        await returnToMenu();
        return;
      }
      saveCliCache({ lastSeedUrls: seedUrlsRaw.trim() });
      console.log(`   Sẽ quét ${seedUrls.length} URL gốc: ${seedUrls.join(', ')}`);

      // 2. Hỏi Auth credentials (sử dụng cache lần trước làm mặc định)
      const nonInteractive = process.argv.includes('--non-interactive');
      let discoveryAuthInfo = null;

      if (!nonInteractive) {
        let suggestedLoginUrl = cliCache.lastLoginUrl || seedUrls[0] || '';
        try {
          const parsedSeed = new URL(seedUrls[0]);
          if (parsedSeed.pathname === '/' || parsedSeed.pathname === '') {
            suggestedLoginUrl = cliCache.lastLoginUrl || seedUrls[0];
          } else if (/(login|dang-nhap|signin)/i.test(parsedSeed.pathname)) {
            suggestedLoginUrl = seedUrls[0];
          } else {
            suggestedLoginUrl = cliCache.lastLoginUrl || (parsedSeed.origin + '/login');
          }
        } catch {}

        const authAnswers = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'needsAuth',
            message: 'Ứng dụng có yêu cầu đăng nhập không?',
            default: cliCache.lastNeedsAuth !== undefined ? cliCache.lastNeedsAuth : true,
          },
          {
            type: 'input',
            name: 'loginUrl',
            message: 'URL trang đăng nhập:',
            default: cliCache.lastLoginUrl || suggestedLoginUrl,
            when: (answers) => answers.needsAuth,
            validate: (v) => (v && v.trim() ? true : 'Bắt buộc nhập URL.'),
          },
          {
            type: 'input',
            name: 'username',
            message: 'Username / Email:',
            default: cliCache.lastUsername || 'admin@practicesoftwaretesting.com',
            when: (answers) => answers.needsAuth,
          },
          {
            type: 'password',
            name: 'password',
            message: 'Password:',
            default: cliCache.lastPassword || 'welcome01',
            mask: '*',
            when: (answers) => answers.needsAuth,
          },
        ]);

        saveCliCache({
          lastNeedsAuth: authAnswers.needsAuth,
          ...(authAnswers.needsAuth ? {
            lastLoginUrl: authAnswers.loginUrl,
            lastUsername: authAnswers.username,
            lastPassword: authAnswers.password,
          } : {}),
        });

        if (authAnswers.needsAuth) {
          discoveryAuthInfo = {
            loginUrl: authAnswers.loginUrl,
            username: authAnswers.username,
            password: authAnswers.password,
          };
        }
      }

      let authSession = createNoAuthSession();
      if (discoveryAuthInfo) {
        console.log('[Auth] Đang mở trình duyệt để xác thực Discovery Crawler...');
        try {
          authSession = await captureAuthSession({
            strategy: 'PLAYWRIGHT_STORAGE_STATE',
            loginUrl: discoveryAuthInfo.loginUrl,
            username: discoveryAuthInfo.username,
            password: discoveryAuthInfo.password,
          });
        } catch (authErr) {
          console.warn(`⚠️ [Auth Warning] Xác thực không thành công: ${authErr.message}. Tiếp tục quét với No-Auth...`);
        }
      }

      // 3. Chạy Discovery Crawler
      console.log('\n🔍 [Discovery Crawler] Đang mở browser và quét trang...');
      const { runDiscoveryCrawler, buildDiscoveryReport } = await import("./agents/crawler/discovery-crawler.js");
      let discoveryResult;
      try {
        discoveryResult = await runDiscoveryCrawler(
          seedUrls,
          authSession ?? createNoAuthSession(),
          {
            maxPages: 15,
            maxDepth: 3,
            headless: true,
          },
          discoveryAuthInfo ?? undefined,
        );
      } catch (err) {
        console.error(`   ❌ Discovery Crawler thất bại: ${err.message}`);
        await returnToMenu();
        return;
      }

      if (discoveryResult.totalPages === 0 || discoveryResult.totalElements === 0) {
        console.error('   ❌ Không phát hiện được element nào. Kiểm tra lại URL và quyền truy cập.');
        await returnToMenu();
        return;
      }

      console.log(`✅ Đã quét xong ${discoveryResult.totalPages} trang, thu thập ${discoveryResult.totalElements} element.`);

      // 4. Lưu report
      if (!fs.existsSync("artifacts")) fs.mkdirSync("artifacts");
      const discoveryReport = buildDiscoveryReport(discoveryResult);
      fs.writeFileSync("artifacts/discovery-dom.md", discoveryReport);
      fs.writeFileSync("artifacts/discovery-dom.json", JSON.stringify(discoveryResult, null, 2));
      console.log('   Lưu tại: artifacts/discovery-dom.md & artifacts/discovery-dom.json');

      // 5. Gọi Discovery Planner (AI tự sinh kịch bản từ element + auth info)
      const { runDiscoveryPlanner } = await import("./agents/planner/run.js");
      const plannerSuccess = await runDiscoveryPlanner(discoveryReport, discoveryAuthInfo ?? undefined);
      if (!plannerSuccess) {
        console.error('   ❌ Discovery Planner không sinh được kế hoạch hợp lệ.');
        await returnToMenu();
        return;
      }
      plannerCompleted = true;

      // 6. Live Crawler xác minh DOM theo Action Intent (tái sử dụng luồng hiện có)
      console.log("\n[Crawler Agent] Dang khoi chay Live Crawler de xac minh Action Intent tren DOM that...");
      try {
        const parsedCases = plannerPlanToTestCases(loadStructuredE2EPlan());
        const snapshotsMap = await runLive(parsedCases, authSession ?? createNoAuthSession());
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
          console.warn(`   ⚠️ ${unresolvedActions.length} action chưa xác minh được. Chi tiết: artifacts/unresolved-actions.json`);
          console.warn('   Discovery Mode: tiếp tục Generator dù có unresolved (AI sẽ cố gắng tự vá).');
        }
        console.log(`   Da van dap va thu thap ${totalSnapshots} DOM snapshot(s) theo tung trang thai.`);
      } catch (err) {
        console.warn(`   ⚠️ Live Crawler gặp lỗi: ${err.message}`);
        console.warn('   Discovery Mode: tiếp tục Generator từ Planner Plan (không có verified locator).');
      }

      // contextData cho generator (dùng discovery report làm context)
      contextData = discoveryReport;

    } else {
      // ═══════════════════════════════════════════════════════════════
      // SCRIPT MODE: Luồng hiện tại (nhập kịch bản thủ công)
      // ═══════════════════════════════════════════════════════════════
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

        // === AUTH HELPER: Xác thực đơn giản cho Crawler ===
        let authSession = createNoAuthSession();
        const nonInteractive = process.argv.includes('--non-interactive');

        if (!nonInteractive) {
          const detectedLoginUrl = parsedCases
            .flatMap(tc => tc.steps)
            .find(s => s.type === 'goto' && /(?:login|signin|sign-in|dang-nhap)/i.test(s.url || ''))?.url || '';

          const cliCache = loadCliCache();
          const authAnswers = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'needsAuth',
              message: 'Ứng dụng có yêu cầu đăng nhập không?',
              default: cliCache.lastNeedsAuth !== undefined ? cliCache.lastNeedsAuth : false,
            },
            {
              type: 'input',
              name: 'loginUrl',
              message: 'URL trang đăng nhập:',
              default: cliCache.lastLoginUrl || detectedLoginUrl || 'https://www.saucedemo.com/',
              when: (answers) => answers.needsAuth,
              validate: (v) => (v && v.trim() ? true : 'Bắt buộc nhập URL.'),
            },
            {
              type: 'input',
              name: 'username',
              message: 'Username / Email:',
              default: cliCache.lastUsername || 'standard_user',
              when: (answers) => answers.needsAuth,
            },
            {
              type: 'password',
              name: 'password',
              message: 'Password:',
              default: cliCache.lastPassword || 'secret_sauce',
              mask: '*',
              when: (answers) => answers.needsAuth,
            },
          ]);

          if (authAnswers.needsAuth) {
            saveCliCache({
              lastNeedsAuth: true,
              lastLoginUrl: authAnswers.loginUrl,
              lastUsername: authAnswers.username,
              lastPassword: authAnswers.password,
            });
            console.log('[Auth] Đang mở trình duyệt để xác thực...');
            authSession = await captureAuthSession({ strategy: 'PLAYWRIGHT_STORAGE_STATE', ...authAnswers });
          }
        }

        const snapshotsMap = await runLive(parsedCases, authSession ?? createNoAuthSession());

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
    }
  } else if (level === "integration") {

    const { apiDesc } = await inquirer.prompt([
      {
        type: "input",
        name: "apiDesc",
        message: "Nhập Endpoint API, kịch bản hoặc đường dẫn file OpenAPI/Swagger:",
      },
    ]);

    // Chuẩn hóa đường dẫn nếu người dùng kéo thả file hoặc dán dạng PowerShell & 'path'
    let cleanedInput = apiDesc.trim().replace(/^&\s*/, '').replace(/^['"]|['"]$/g, '');
    let resolvedPath = path.resolve(process.cwd(), cleanedInput);

    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      console.log(`\n📂 Đã nhận diện file đặc tả: ${resolvedPath}`);
      try {
        const fileExt = path.extname(resolvedPath).toLowerCase();
        if (fileExt === '.yaml' || fileExt === '.yml' || fileExt === '.json') {
          // Nạp file qua contract-loader / fs
          const rawContent = fs.readFileSync(resolvedPath, 'utf-8');
          contextData = `[FILE ĐẶC TẢ API: ${path.basename(resolvedPath)}]\n${rawContent}`;
        } else {
          contextData = fs.readFileSync(resolvedPath, 'utf-8');
        }
      } catch (err) {
        console.error(`⚠️ Lỗi khi đọc file: ${err.message}. Sẽ dùng trực tiếp nội dung nhập.`);
        contextData = apiDesc;
      }
    } else {
      contextData = apiDesc;
    }
  } else if (level === "unit") {
    section(
      "UNIT",
      "Kiểm thử Whitebox",
      "Đọc source thật • phân tích AST • sinh Vitest có kiểm chứng",
    );
    const { inputMode } = await inquirer.prompt([
      {
        type: "list",
        name: "inputMode",
        message: "Bạn muốn cung cấp mã nguồn theo cách nào?",
        choices: [
          { name: "📁 Chọn thư mục dự án", value: "folder" },
          { name: "📄 Chọn một file nguồn", value: "file" },
          { name: "📝 Dán đoạn code export để thử nhanh", value: "paste" },
          new inquirer.Separator(),
          { name: "⬅️  Quay lại Menu chính", value: "back" },
        ],
      },
    ]);
    if (inputMode === "back") {
      await mainMenu();
      return;
    }
    let unitInputPath = "";
    if (inputMode === "paste") {
      const { pastedCode } = await inquirer.prompt([
        {
          type: "editor",
          name: "pastedCode",
          message: "Dán code JavaScript/TypeScript (target phải có export):",
        },
      ]);
      const snippetDir = path.join(
        process.cwd(),
        ".testkit",
        "unit-inputs",
        `snippet_${Date.now()}`,
      );
      fs.mkdirSync(snippetDir, { recursive: true });
      unitInputPath = path.join(snippetDir, "snippet.ts");
      fs.writeFileSync(unitInputPath, `${pastedCode.trim()}\n`);
    } else {
      const { sourcePath } = await inquirer.prompt([
        {
          type: "input",
          name: "sourcePath",
          message:
            inputMode === "folder"
              ? "Nhập đường dẫn thư mục gốc dự án cần test:"
              : "Nhập đường dẫn file nguồn cần test:",
          validate: (value) =>
            value.trim() ? true : "Đường dẫn không được để trống.",
        },
      ]);
      unitInputPath = path.resolve(sourcePath.trim());
    }

    let analysis;
    try {
      analysis = analyzeUnitInput(unitInputPath);
    } catch (error) {
      uiError(`Code Reader không thể phân tích: ${error.message}`);
      await returnToMenu();
      return;
    }
    const eligibleTargets = analysis.index.targets.filter(
      (target) => target.executionMode !== "UNSUPPORTED",
    );
    if (eligibleTargets.length === 0) {
      uiError("Không tìm thấy hàm/class được export để sinh Unit Test.");
      detail(
        "Yêu cầu",
        "Target phải được export để file test import source thật.",
      );
      await returnToMenu();
      return;
    }
    summary("Kết quả quét mã nguồn", [
      ["Dự án", analysis.manifest.projectName],
      ["File nguồn", String(analysis.manifest.sourceFiles.length)],
      [
        "Target",
        `${eligibleTargets.length}/${analysis.index.targets.length} có thể test`,
      ],
      ["Framework", analysis.manifest.testFramework],
    ]);
    if (analysis.manifest.testFramework === "unknown") {
      uiError("Dự án chưa cấu hình Vitest hoặc Jest.");
      detail(
        "Hành động",
        "Cấu hình test runner trong dự án đích rồi quét lại.",
      );
      await returnToMenu();
      return;
    }

    let selectedTargetIds = eligibleTargets.map((target) => target.id);
    if (eligibleTargets.length > 1) {
      const { selectionMode } = await inquirer.prompt([
        {
          type: "list",
          name: "selectionMode",
          message: "Chọn phạm vi Planner Unit:",
          choices: [
            { name: "Chọn hàm/class cụ thể (khuyến nghị)", value: "choose" },
            {
              name: `Phân tích tất cả ${eligibleTargets.length} target`,
              value: "all",
            },
            new inquirer.Separator(),
            { name: "⬅️  Quay lại Menu chính", value: "back" },
          ],
        },
      ]);
      if (selectionMode === "back") {
        await mainMenu();
        return;
      }
      if (selectionMode === "choose") {
        const { selected } = await inquirer.prompt([
          {
            type: "checkbox",
            name: "selected",
            message: "Chọn target cần sinh test:",
            pageSize: 20,
            choices: eligibleTargets.map((target) => ({
              name: `${target.sourceFile}  ›  ${target.symbol} ${profile(target.profile)}`,
              value: target.id,
            })),
            validate: (value) =>
              value.length > 0 ? true : "Phải chọn ít nhất một target.",
          },
        ]);
        selectedTargetIds = selected;
      }
    }
    const { requirements } = await inquirer.prompt([
      {
        type: "editor",
        name: "requirements",
        message:
          "Nhập yêu cầu nghiệp vụ/expected nhiều dòng (lưu và đóng editor khi xong):",
      },
    ]);
    const normalizedRequirements = String(requirements || "").trim();
    if (normalizedRequirements) {
      const requirementLineCount = normalizedRequirements.split(/\r?\n/).length;
      success(`Đã nhận đầy đủ ${requirementLineCount} dòng yêu cầu nghiệp vụ.`);
    } else {
      detail(
        "Yêu cầu nghiệp vụ",
        "Để trống; hệ thống chỉ kiểm tra hành vi suy ra từ source.",
      );
    }
    try {
      const prepared = createUnitSession(
        analysis,
        selectedTargetIds,
        normalizedRequirements,
      );
      contextData = JSON.stringify(prepared.context);
      success("Đã chuẩn bị dữ liệu cho Planner.");
      artifact("Phiên chạy", path.basename(prepared.session.runDirectory));
    } catch (error) {
      uiError(`Không tạo được Unit Context: ${error.message}`);
      await returnToMenu();
      return;
    }
  }

  // Bước 1: Gọi Planner
  const isPlanSuccess =
    plannerCompleted || (await runPlanner(level, contextData));

  if (isPlanSuccess) {
    const { confirmGen } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmGen",
        message: "Kế hoạch đã sẵn sàng. Sinh file test ngay?",
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

      await runAutoHealGeneratorLoop(level, { targetFile: targetName });
      if (level === "unit") {
        await reviewPendingUnitOracles({ askToStart: true });
      }
    }
  }

  await returnToMenu();
}

function editableOracleValue(value) {
  if (value && typeof value === "object" && value.$type === "undefined")
    return "undefined";
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

async function askTesterExpected(proposed) {
  if (!proposed)
    throw new Error(
      "Chưa có dạng kết quả đề xuất để tester chỉnh sửa an toàn.",
    );
  const kind = proposed.kind;
  if (kind === "return" || kind === "resolve") {
    const { rawValue } = await inquirer.prompt([
      {
        type: "input",
        name: "rawValue",
        message: "Nhập giá trị đúng (ví dụ: true, 10, văn bản hoặc JSON):",
        default: editableOracleValue(proposed?.value),
        validate: (value) => {
          try {
            parseTesterDataValue(value);
            return true;
          } catch (error) {
            return error.message;
          }
        },
      },
    ]);
    return { kind, value: parseTesterDataValue(rawValue) };
  }
  const proposedMessage =
    proposed?.error?.message?.value ||
    proposed?.message ||
    (typeof proposed?.value === "string" ? proposed.value : "");
  const { errorMessage, match } = await inquirer.prompt([
    {
      type: "input",
      name: "errorMessage",
      message: "Thông báo lỗi đúng là gì?",
      default: proposedMessage,
      validate: (value) =>
        value.trim() ? true : "Thông báo lỗi không được để trống.",
    },
    {
      type: "list",
      name: "match",
      message: "So sánh thông báo lỗi theo cách nào?",
      choices: [
        {
          name: "Chỉ cần có chứa nội dung này (khuyến nghị)",
          value: "contains",
        },
        { name: "Phải giống hoàn toàn", value: "equals" },
      ],
    },
  ]);
  return {
    kind,
    error: { message: { match, value: errorMessage.trim() } },
  };
}

function showOracleRequest(request, index, total) {
  section(
    "03",
    `Xác nhận kết quả ${index + 1}/${total}`,
    "Không cần đọc source code hay mở file JSON",
  );
  summary(
    "Tester cần quyết định",
    [
      ["Chức năng", humanizeUnitTarget(request.target)],
      ["Trường hợp", request.name || request.testCaseId],
      ["Đề xuất", formatExpectedForTester(request.proposedExpected)],
    ],
    "warning",
  );
  console.log(`\n   ${paint.bold("Dữ liệu đầu vào")}`);
  for (const line of formatInputsForTester(request.inputs)) detail("", line);
  console.log(
    `\n   ${paint.muted("Hệ thống chưa thể tự chứng minh kết quả này từ mã nguồn.")}`,
  );
  console.log(
    `   ${paint.muted("Tester chỉ xác nhận khi đây đúng là hành vi mong muốn của nghiệp vụ.")}`,
  );
}

async function reviewPendingUnitOracles({ askToStart = true } = {}) {
  let requests;
  try {
    requests = loadPendingUnitOracleRequests();
  } catch (error) {
    uiError(`Không đọc được phiên Unit hiện tại: ${error.message}`);
    return false;
  }
  if (requests.length === 0) {
    success("Không có test case Unit nào đang chờ xác nhận.");
    return false;
  }
  if (askToStart) {
    const { startReview } = await inquirer.prompt([
      {
        type: "confirm",
        name: "startReview",
        message: `Có ${requests.length} kết quả cần tester xác nhận. Xác nhận ngay trên CLI?`,
        default: true,
      },
    ]);
    if (!startReview) {
      detail("Làm sau", "Chọn mục 05 - Xác nhận kết quả Unit ở menu chính.");
      return false;
    }
  }

  const confirmations = [];
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    let decided = false;
    while (!decided) {
      showOracleRequest(request, index, requests.length);
      const choices = [];
      if (request.proposedExpected) {
        choices.push({
          name: "Đúng, dùng kết quả hệ thống đang đề xuất",
          value: "confirm",
        });
        if (request.proposedExpected.kind !== "side-effect") {
          choices.push({
            name: "Kết quả chưa đúng, tôi muốn nhập lại",
            value: "edit",
          });
        }
      }
      choices.push(
        { name: "Tạm bỏ qua test case này", value: "skip" },
        { name: "Cần BA/Developer xác nhận thêm", value: "review" },
        { name: "Xem lý do kỹ thuật", value: "details" },
        { name: "Dừng tại đây và lưu các lựa chọn đã làm", value: "stop" },
      );
      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: "Kết quả mong đợi đúng là gì?",
          choices,
        },
      ]);
      if (action === "details") {
        warning("Giải thích kỹ thuật (chỉ để tham khảo):");
        for (const reason of request.reasons || []) detail("", reason);
        continue;
      }
      if (action === "stop") {
        index = requests.length;
        break;
      }
      const confirmedAt = new Date().toISOString();
      if (action === "confirm") {
        confirmations.push({
          target: request.target,
          testCaseId: request.testCaseId,
          status: "CONFIRMED",
          expected: request.proposedExpected,
          confirmedAt,
        });
      } else if (action === "edit") {
        const expected = await askTesterExpected(request.proposedExpected);
        confirmations.push({
          target: request.target,
          testCaseId: request.testCaseId,
          status: "CONFIRMED",
          expected,
          confirmedAt,
        });
      } else {
        confirmations.push({
          target: request.target,
          testCaseId: request.testCaseId,
          status: action === "review" ? "NEEDS_REVIEW" : "SKIPPED",
          confirmedAt,
        });
      }
      decided = true;
    }
  }

  if (confirmations.length === 0) return false;
  let result;
  try {
    result = applyUnitOracleConfirmations(confirmations);
  } catch (error) {
    uiError(`Không lưu được xác nhận: ${error.message}`);
    return false;
  }
  summary(
    "Đã lưu lựa chọn của tester",
    [
      ["Đã xác nhận", String(result.confirmedCount)],
      ["Tạm bỏ qua", String(result.skippedCount)],
      ["Cần xem lại", String(result.needsReviewCount)],
    ],
    result.confirmedCount > 0 ? "success" : "warning",
  );

  if (result.confirmedTargetIds.length > 0) {
    section(
      "04",
      "Tạo lại Unit Test",
      "Dùng xác nhận vừa nhập • không gọi Planner • không gọi AI",
    );
    await runUnitGenerator({
      preserveExistingFiles: true,
      onlyTargetIds: result.confirmedTargetIds,
    });
  }
  return result.confirmedCount > 0;
}

// 3. TÍNH NĂNG: CHẠY TEST VÀ KÍCH HOẠT CHÍNH SÁCH BẮT LỖI
async function runTests(level) {
  section(
    "RUN",
    `Chạy ${level.toUpperCase()}`,
    "Thực thi test và tổng hợp kết quả",
  );

  if (level === "unit") {
    let gateReport;
    try {
      gateReport = loadCurrentUnitOracleGateReport();
      oracleSummary(gateReport.counts);
    } catch (error) {
      warning(`Chưa đọc được Oracle Gate của phiên hiện tại: ${error.message}`);
    }
    let unitResult;
    try {
      unitResult = runLastGeneratedUnitTests();
    } catch (error) {
      uiError(`Không thể chạy Unit Test gần nhất: ${error.message}`);
      await returnToMenu();
      return;
    }
    detail("Dự án", path.basename(unitResult.cwd));
    const runSummary = summarizeUnitRunOutput(
      unitResult.stdout,
      unitResult.stderr,
    );
    summary(
      "Kết quả thực thi",
      [
        [
          "File test",
          `${runSummary.passedFiles}/${runSummary.totalFiles} pass`,
        ],
        [
          "Test case",
          `${runSummary.passedTests}/${runSummary.totalTests} pass`,
        ],
        ["Thất bại", String(runSummary.failedTests)],
        ["Coverage", unitResult.coverageEnabled ? "Đã bật" : "Chưa bật"],
      ],
      unitResult.ok ? "success" : "error",
    );
    if (unitResult.ok) {
      success("Tất cả Unit Test đã pass.");
      if (gateReport) {
        testExecutionSummary({
          specPassed:
            gateReport.counts.specRequirement +
            gateReport.counts.specTesterConfirmed,
          specTotal:
            gateReport.counts.specRequirement +
            gateReport.counts.specTesterConfirmed,
          charPassed: gateReport.counts.characterization,
          charTotal: gateReport.counts.characterization,
          conflicts: gateReport.counts.sourceConflict,
          needsOracle: gateReport.counts.needsOracle,
        });
      }
      unitResult.coverageEnabled
        ? success("Coverage đã được ghi nhận.")
        : warning("Test đã pass nhưng dự án chưa có coverage provider.");
      const coverageLoop = await runUnitCoverageGuidedLoop(unitResult);
      unitResult = coverageLoop.finalRun;
      if (coverageLoop.status === "TARGET_REACHED") {
        success("Coverage đã đạt ngưỡng 80% cho các target được đo.");
      } else if (coverageLoop.rounds.length > 0) {
        warning(
          `Coverage kết thúc ở trạng thái ${coverageLoop.status} sau ${coverageLoop.rounds.length} vòng.`,
        );
      }
    } else {
      const errorMessage = `${unitResult.stdout}\n${unitResult.stderr}`.trim();
      uiError("Unit Test chưa pass.");
      for (const failedName of runSummary.failedNames.slice(0, 3)) {
        detail("Test lỗi", failedName);
      }
      if (runSummary.failedNames.length > 3) {
        detail("Còn lại", `${runSummary.failedNames.length - 3} test case`);
      }
      if (runSummary.primaryError)
        detail("Nguyên nhân", runSummary.primaryError);
      artifact("Log đầy đủ", "test-results.json");
      await runHealer("unit", errorMessage);
      const result = await harness.handleTestFailure(
        "unit",
        "Generated Unit Suite",
        errorMessage,
      );
      fs.mkdirSync("artifacts", { recursive: true });
      fs.writeFileSync("artifacts/report.md", result.report);
      success("Đã lưu báo cáo chẩn đoán.");
      artifact("Báo cáo", "artifacts/report.md");
    }
    await returnToMenu();
    return;
  }

  if (level === "integration") {
    const intResult = await runIntegrationSandbox();
    if (intResult.ok) {
      success("Tất cả Integration Test đã pass trong Sandbox Harness.");
      artifact("Báo cáo", intResult.reportPath);
    } else {
      uiError("Integration Test chưa pass.");
      await runHealer("integration", "Integration Sandbox Test Suite Failed");
    }
    await returnToMenu();
    return;
  }

  // E2E Level Runner
  let targetSpec = "tests/e2e";
  const e2eDir = "tests/e2e";
  if (fs.existsSync(e2eDir)) {
    const specFiles = fs.readdirSync(e2eDir).filter(f => f.endsWith('.spec.ts'));
    if (specFiles.length > 0 && !process.argv.includes('--non-interactive')) {
      const { selectedSpec } = await inquirer.prompt([
        {
          type: "list",
          name: "selectedSpec",
          message: "Chọn phạm vi chạy E2E:",
          choices: [
            { name: "⚡ Chạy tất cả các bộ test E2E (tests/e2e)", value: "tests/e2e" },
            new inquirer.Separator(),
            ...specFiles.map(f => ({ name: `📄 ${f}`, value: path.join("tests", "e2e", f).replace(/\\/g, "/") })),
            new inquirer.Separator(),
            { name: "⬅️  Quay lại Menu chính", value: "back" },
          ]
        }
      ]);
      if (selectedSpec === "back") {
        await mainMenu();
        return;
      }
      targetSpec = selectedSpec;
    }
  }

  let e2eMode = "headless";
  if (process.argv.includes('--ui')) {
    e2eMode = "ui";
  } else if (process.argv.includes('--headed')) {
    e2eMode = "headed";
  } else if (!process.argv.includes('--non-interactive')) {
    const { selectedMode } = await inquirer.prompt([
      {
        type: "list",
        name: "selectedMode",
        message: "Chọn chế độ thực thi E2E:",
        choices: [
          { name: "⚡ Chạy ngầm (Headless Mode - Mặc định, nhanh, tự động vá lỗi Healer)", value: "headless" },
          { name: "🖥️  Chạy mở trình duyệt (Headed Mode - Xem browser tự động thao tác)", value: "headed" },
          { name: "🎨 Giao diện Playwright UI (--ui Mode - Tương tác trực quan, xem lại từng bước, time-travel)", value: "ui" },
          new inquirer.Separator(),
          { name: "⬅️  Quay lại Menu chính", value: "back" },
        ]
      }
    ]);
    if (selectedMode === "back") {
      await mainMenu();
      return;
    }
    e2eMode = selectedMode;
  }

  // Nếu chọn chế độ Playwright UI Mode
  if (e2eMode === "ui") {
    section("PLAYWRIGHT UI", "Giao diện Playwright UI Mode", `Đang mở dashboard tương tác cho: ${targetSpec}`);
    detail("Tính năng", "Xem DOM snapshot, tua lại các bước (time-travel), debug network & console log.");
    try {
      execSync(`npx playwright test "${targetSpec}" --ui`, { stdio: "inherit" });
      success("Đã đóng giao diện Playwright UI.");
    } catch (err) {
      // Khi user đóng cửa sổ UI, process kết thúc
    }
    await returnToMenu();
    return;
  }

  let command = `npx playwright test "${targetSpec}"${e2eMode === "headed" ? " --headed" : ""} --retries=1`;
  const maxAttempts = 3;
  let attempt = 1;
  let allPassed = false;

  while (attempt <= maxAttempts && !allPassed) {
    if (attempt > 1) {
      section("HEAL", `Vòng tự sửa lỗi (Attempt ${attempt}/${maxAttempts})`, "Healer đang chữa lành và chạy lại bài test");
    }

    try {
      const output = execSync(command, { encoding: "utf-8" });
      console.log(output);
      success(`Tất cả test ${level.toUpperCase()} đã pass${attempt > 1 ? ` sau khi Healer tự động sửa (Vòng ${attempt})` : ''}.`);
      allPassed = true;
    } catch (error) {
      const errorMessage = error.stdout || error.message;
      uiError(`Test ${level.toUpperCase()} gặp lỗi ở vòng ${attempt}/${maxAttempts}.`);

      if (attempt < maxAttempts) {
        detail("Healer", "Đang phân tích lỗi và tự động vá mã nguồn...");
        const { healSpecFile } = await import("./agents/healer/run.js");
        
        // Tìm các file spec bị lỗi từ log
        const matchedSpecs = String(errorMessage).match(/tests[\\/]e2e[\\/][a-zA-Z0-9_\-\.]+\.spec\.ts/g) || [];
        const uniqueSpecs = [...new Set(matchedSpecs.map(p => p.replace(/\\/g, '/')))];

        let anyHealed = false;
        if (uniqueSpecs.length > 0) {
          for (const specPath of uniqueSpecs) {
            if (fs.existsSync(specPath)) {
              const healRes = healSpecFile(specPath, errorMessage);
              if (healRes.ok) {
                anyHealed = true;
                healRes.fixes.forEach(fix => detail("Đã vá", `${path.basename(specPath)}: ${fix}`));
              }
            }
          }
        } else if (targetSpec.endsWith('.spec.ts') && fs.existsSync(targetSpec)) {
          const healRes = healSpecFile(targetSpec, errorMessage);
          if (healRes.ok) {
            anyHealed = true;
            healRes.fixes.forEach(fix => detail("Đã vá", `${path.basename(targetSpec)}: ${fix}`));
          }
        }

        if (anyHealed) {
          success("Healer đã áp dụng các bản vá tự động. Đang chạy lại kiểm thử...");
          attempt++;
          continue;
        }
      }

      detail("Tiếp theo", "Đang chạy chẩn đoán và tạo báo cáo.");
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
      success("Đã tạo báo cáo chẩn đoán.");
      artifact("Báo cáo", "artifacts/report.md");
      break;
    }
  }

  await returnToMenu();
}

// 4. TÍNH NĂNG: XEM BÁO CÁO CẬP NHẬT
function showReport() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  📊 DANH SÁCH BÁO CÁO KIỂM THỬ GẦN NHẤT");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  let foundAny = false;

  const htmlReport = path.resolve("artifacts/api-test-report.html");
  if (fs.existsSync(htmlReport)) {
    console.log(`  🌐 Báo cáo HTML Trực quan: file:///${htmlReport.replace(/\\/g, '/')}`);
    foundAny = true;
  }

  const xmlReport = path.resolve("artifacts/api-test-report.xml");
  if (fs.existsSync(xmlReport)) {
    console.log(`  📑 Báo cáo chuẩn JUnit XML: file:///${xmlReport.replace(/\\/g, '/')}`);
    foundAny = true;
  }

  if (fs.existsSync("artifacts/report.md")) {
    const content = fs.readFileSync("artifacts/report.md", "utf-8");
    console.log("\n  📄 Báo cáo E2E gần nhất (artifacts/report.md):");
    console.log(content.slice(0, 1000) + (content.length > 1000 ? "\n  ... [Xem tiếp trong file]" : ""));
    foundAny = true;
  }

  if (!foundAny) {
    warning("Chưa có báo cáo kiểm thử nào được ghi nhận.");
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  returnToMenu();
}

// HÀM PHỤ TỰ QUAY LẠI MENU
async function returnToMenu() {
  if (process.argv.includes("--non-interactive")) {
    return;
  }
  await inquirer.prompt([
    {
      type: "input",
      name: "continue",
      message: paint.muted("Nhấn Enter để quay lại menu chính"),
    },
  ]);
  await mainMenu();
}

// XỬ LÝ KHỞI CHẠY CLI: INTERACTIVE NẾU KHÔNG CÓ CỜ, NON-INTERACTIVE NẾU CÓ CỜ
async function runCliEntrypoint() {
  const args = process.argv.slice(2);
  const isNonInteractive = args.includes("--non-interactive");

  let level = null;
  const levelIdx = args.indexOf("--level");
  if (levelIdx !== -1 && args[levelIdx + 1]) {
    level = args[levelIdx + 1];
  }

  if (isNonInteractive || level) {
    header();
    const targetLevel = level || "unit";
    section(
      "CLI",
      `CHẠY NON-INTERACTIVE PIPELINE [${targetLevel.toUpperCase()}]`,
      "Thực thi CI/CD tự động",
    );

    try {
      if (targetLevel === "unit") {
        const gateReport = loadCurrentUnitOracleGateReport();
        oracleSummary(gateReport.counts);
        if (!gateReport.canRunInCi) {
          uiError(
            "Oracle Gate từ chối chạy CI: còn conflict hoặc expected chưa được xác minh.",
          );
          for (const reason of gateReport.blockingReasons.slice(0, 5)) {
            detail("Bị chặn", reason);
          }
          process.exit(1);
        }
        const unitResult = runLastGeneratedUnitTests();
        const runSummary = summarizeUnitRunOutput(
          unitResult.stdout,
          unitResult.stderr,
        );

        if (!unitResult.ok || runSummary.failedTests > 0) {
          uiError(
            `Pipeline CI thất bại: Có ${runSummary.failedTests} test case bị lỗi.`,
          );
          process.exit(1);
        } else {
          success("Tất cả Unit Test đã pass thành công trong CI.");
          testExecutionSummary({
            specPassed:
              gateReport.counts.specRequirement +
              gateReport.counts.specTesterConfirmed,
            specTotal:
              gateReport.counts.specRequirement +
              gateReport.counts.specTesterConfirmed,
            charPassed: gateReport.counts.characterization,
            charTotal: gateReport.counts.characterization,
            conflicts: gateReport.counts.sourceConflict,
            needsOracle: gateReport.counts.needsOracle,
          });
          process.exit(0);
        }
      } else if (targetLevel === "integration") {
        const intResult = await runIntegrationSandbox();
        if (!intResult.ok) {
          uiError(`Integration Sandbox Pipeline thất bại.`);
          process.exit(1);
        }
        success("Integration Test pass thành công trong Sandbox Harness.");
        process.exit(0);
      } else if (targetLevel === "e2e") {
        const isUI = process.argv.includes('--ui');
        const isHeaded = process.argv.includes('--headed');
        const cmd = `npx playwright test tests/e2e${isUI ? ' --ui' : (isHeaded ? ' --headed' : '')}`;
        execSync(cmd, { stdio: "inherit" });
        success("E2E Test pass.");
        process.exit(0);
      } else {
        uiError(`Tầng kiểm thử không hợp lệ: ${targetLevel}`);
        process.exit(2);
      }
    } catch (err) {
      uiError(`Pipeline thất bại với lỗi: ${err.message}`);
      process.exit(1);
    }
  } else {
    mainMenu();
  }
}

// KHỞI CHẠY CLI
runCliEntrypoint();
