/**
 * API Test Wizard — Giao diện CLI tương tác để test bất kỳ dự án nào.
 *
 * Tester chỉ cần:
 * 1. Cung cấp file OpenAPI (JSON hoặc YAML)
 * 2. Nhập Base URL của dự án đang chạy
 * 3. (Tùy chọn) Cấu hình Auth
 * → Hệ thống tự sinh và chạy test, không cần sửa code.
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {
  loadOpenApiSpec,
  extractOpenApiModules,
  generateApiTestSuiteFromOpenApi,
  writeApiTestSuiteArtifact,
  renderApiTestPlanMarkdown,
} from './contract-loader.js';
import { runApiTestSuite, writeApiRunArtifacts } from './runner.js';
import { computeApiOracleGate } from './oracle.js';
import type { ApiTestSuite } from './schema.js';

// ─── Lưu cấu hình phiên trước ────────────────────────────────────────────────

const WIZARD_CONFIG_PATH = path.join(process.cwd(), 'artifacts', '.api-wizard-last.json');

interface WizardConfig {
  specFilePath: string;
  baseUrl: string;
  authType: 'none' | 'bearer' | 'apikey' | 'basic';
  authValue?: string;
  authKeyHeader?: string;
  onlyPaths?: string[];
}

function saveWizardConfig(config: WizardConfig): void {
  try {
    fs.mkdirSync(path.dirname(WIZARD_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(WIZARD_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  } catch { /* không quan trọng nếu lưu thất bại */ }
}

function loadLastWizardConfig(): WizardConfig | null {
  try {
    if (fs.existsSync(WIZARD_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(WIZARD_CONFIG_PATH, 'utf-8')) as WizardConfig;
    }
  } catch { /* ignore */ }
  return null;
}

// ─── Readline helpers ─────────────────────────────────────────────────────────

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

function promptWithDefault(
  rl: readline.Interface,
  question: string,
  defaultValue: string,
): Promise<string> {
  return new Promise(resolve =>
    rl.question(`${question} [${defaultValue}]: `, answer => {
      const val = answer.trim();
      resolve(val === '' ? defaultValue : val);
    }),
  );
}

async function promptSecret(rl: readline.Interface, question: string): Promise<string> {
  process.stdout.write(question);
  // Trên Windows readline không ẩn được input; chỉ hiển thị cảnh báo
  return new Promise(resolve => {
    process.stdout.write('(giá trị sẽ hiển thị, xóa log sau khi dùng)\n');
    rl.question('  > ', answer => resolve(answer.trim()));
  });
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function printBanner() {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🌐  API INTEGRATION TEST WIZARD');
  console.log('      Test bất kỳ dự án nào — Không cần sửa code');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export async function runApiTestWizard(): Promise<void> {
  printBanner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  try {
    const lastConfig = loadLastWizardConfig();
    if (lastConfig) {
      console.log('📂 Tìm thấy cấu hình phiên trước:');
      console.log(`   OpenAPI: ${lastConfig.specFilePath}`);
      console.log(`   Base URL: ${lastConfig.baseUrl}`);
      console.log(`   Auth: ${lastConfig.authType}`);
      console.log('');
      const useLastRaw = await prompt(rl, '? Dùng lại cấu hình này không? (Y/n): ');
      const useLast = useLastRaw === '' || useLastRaw.toLowerCase() === 'y';

      if (useLast) {
        rl.close();
        await executeWizard(lastConfig);
        return;
      }
      console.log('');
    }

    // ── BƯỚC 1: File OpenAPI ─────────────────────────────────────────────────
    console.log('📋 BƯỚC 1: Chọn file OpenAPI/Swagger của dự án cần test');
    console.log('   (Hỗ trợ: .json, .yaml, .yml)');
    console.log('   Ví dụ: ./docs/swagger.yaml | D:/my-project/openapi.json');
    console.log('   Mẹo: Mở trang Swagger UI → tìm đường dẫn /api/schema/ hoặc /openapi.json');
    console.log('');

    let specFilePath = '';
    while (true) {
      const raw = await prompt(rl, '? Đường dẫn file OpenAPI: ');
      if (!raw) { console.log('   ⚠️  Không được để trống.'); continue; }
      const resolved = path.resolve(process.cwd(), raw.replace(/^["']|["']$/g, ''));
      if (!fs.existsSync(resolved)) {
        console.log(`   ❌ Không tìm thấy file: "${resolved}"`);
        console.log('      Kiểm tra lại đường dẫn hoặc kéo file vào cửa sổ terminal.');
        continue;
      }
      specFilePath = resolved;
      break;
    }

    // ── BƯỚC 2: Base URL ─────────────────────────────────────────────────────
    console.log('');
    console.log('🌐 BƯỚC 2: Địa chỉ (URL) của dự án đang chạy');
    console.log('   - Dự án đang chạy trên máy tính của bạn: http://localhost:8000');
    console.log('   - Dự án trên môi trường test/staging:     https://staging-api.company.vn');
    console.log('   - Ví dụ Mobifone:                          https://hcm.mobifone.vn');
    console.log('');

    const defaultBaseUrl = lastConfig?.baseUrl || 'http://localhost:8000';
    let baseUrl = '';
    while (true) {
      const raw = await promptWithDefault(rl, '? Base URL của dự án', defaultBaseUrl);
      if (!/^https?:\/\//i.test(raw)) {
        console.log('   ⚠️  URL phải bắt đầu bằng http:// hoặc https://');
        continue;
      }
      baseUrl = raw.replace(/\/+$/, ''); // Xóa trailing slash
      break;
    }

    // ── BƯỚC 3: Xác thực (Auth) ──────────────────────────────────────────────
    console.log('');
    console.log('🔐 BƯỚC 3: Cấu hình xác thực API (nếu cần)');
    console.log('   1. Không cần xác thực (API công khai)');
    console.log('   2. Bearer Token (JWT) — Phổ biến nhất với Django REST, NestJS, Laravel...');
    console.log('   3. API Key — Gửi qua header tùy chỉnh (X-API-Key)');
    console.log('   4. Basic Auth — Username + Password');
    console.log('');

    const authChoiceRaw = await promptWithDefault(rl, '? Chọn kiểu xác thực (1-4)', '1');
    const authChoice = parseInt(authChoiceRaw, 10) || 1;

    let authType: WizardConfig['authType'] = 'none';
    let authValue: string | undefined;
    let authKeyHeader: string | undefined;

    if (authChoice === 2) {
      authType = 'bearer';
      authValue = await promptSecret(rl, '? Nhập Bearer Token (không có chữ "Bearer "):');
    } else if (authChoice === 3) {
      authType = 'apikey';
      authKeyHeader = await promptWithDefault(rl, '? Tên header API Key', 'X-API-Key');
      authValue = await promptSecret(rl, `? Nhập giá trị của header "${authKeyHeader}":`);
    } else if (authChoice === 4) {
      authType = 'basic';
      const username = await prompt(rl, '? Username: ');
      const password = await promptSecret(rl, '? Password:');
      authValue = Buffer.from(`${username}:${password}`).toString('base64');
    }

    // ── BƯỚC 4: Chọn module / lọc endpoint trực quan ───────────────────────
    console.log('');
    console.log('📂 BƯỚC 4: Chọn phạm vi kiểm thử (Module / Domain)');

    let onlyPaths: string[] | undefined;
    try {
      const parsedSpec = loadOpenApiSpec(specFilePath);
      const modules = extractOpenApiModules(parsedSpec);

      if (modules.length > 0) {
        console.log('   Tìm thấy các nhóm module sau trong spec:');
        console.log('   [0] 🌐 TOÀN BỘ API (Tất cả modules)');
        modules.forEach((mod, idx) => {
          console.log(`   [${idx + 1}] 📦 ${mod.name.padEnd(28)} (${mod.prefix}) — ${mod.operationCount} endpoints`);
        });
        console.log('');
        const selectionRaw = await promptWithDefault(
          rl,
          '? Nhập số thứ tự module (ví dụ: 1 hoặc 1,3 hoặc 0 cho tất cả)',
          '0',
        );

        if (selectionRaw !== '0' && selectionRaw.trim() !== '') {
          const selectedIndices = selectionRaw
            .split(/[,+\s]+/)
            .map(s => parseInt(s.trim(), 10))
            .filter(n => !isNaN(n) && n >= 1 && n <= modules.length);

          if (selectedIndices.length > 0) {
            const chosenPaths: string[] = [];
            selectedIndices.forEach(idx => {
              const mod = modules[idx - 1];
              chosenPaths.push(...mod.paths);
              console.log(`   ✅ Đã chọn module: ${mod.name} (${mod.paths.length} paths)`);
            });
            onlyPaths = [...new Set(chosenPaths)];
          }
        }
      }
    } catch {
      // fallback nếu đọc spec bị lỗi ở bước preview
      const filterRaw = await prompt(rl, '? Chỉ test một số endpoint nhất định? (y/N): ');
      if (filterRaw.toLowerCase() === 'y') {
        console.log('   Nhập từng đường dẫn, Enter để kết thúc. Ví dụ: /dema/api/religions/');
        const paths: string[] = [];
        while (true) {
          const p = await prompt(rl, `   Endpoint #${paths.length + 1} (Enter để xong): `);
          if (!p) break;
          paths.push(p.startsWith('/') ? p : `/${p}`);
          console.log(`   ✅ Đã thêm: ${paths[paths.length - 1]}`);
        }
        if (paths.length > 0) onlyPaths = paths;
      }
    }

    rl.close();

    const config: WizardConfig = {
      specFilePath,
      baseUrl,
      authType,
      authValue,
      authKeyHeader,
      onlyPaths,
    };

    saveWizardConfig(config);
    await executeWizard(config);

  } catch (error) {
    rl.close();
    throw error;
  }
}

// ─── Execute — Đọc spec, sinh test, chạy, xuất báo cáo ──────────────────────

async function executeWizard(config: WizardConfig): Promise<void> {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  📖 Đang đọc OpenAPI spec...');

  let spec;
  try {
    spec = loadOpenApiSpec(config.specFilePath);
  } catch (error: any) {
    console.error(`  ❌ ${error.message}`);
    return;
  }

  const specInfo = spec as Record<string, any>;
  console.log(`  ✅ OpenAPI ${specInfo['openapi']} — "${specInfo['info']?.title}" v${specInfo['info']?.version}`);

  // Đếm tổng số paths
  const allPaths = Object.keys(spec.paths || {});
  console.log(`  📌 Tìm thấy ${allPaths.length} paths trong spec`);
  if (config.onlyPaths?.length) {
    console.log(`  🔍 Chỉ test ${config.onlyPaths.length} paths được chọn`);
  }

  console.log('');
  console.log('  ⚙️  Đang sinh test cases từ spec...');

  const suite = generateApiTestSuiteFromOpenApi(spec, config.baseUrl, {
    onlyPaths: config.onlyPaths,
  });

  // Thêm auth headers vào defaultHeaders
  const authHeaders: Record<string, string> = {};
  if (config.authType === 'bearer' && config.authValue) {
    authHeaders['Authorization'] = `Bearer ${config.authValue}`;
  } else if (config.authType === 'apikey' && config.authValue && config.authKeyHeader) {
    authHeaders[config.authKeyHeader] = config.authValue;
  } else if (config.authType === 'basic' && config.authValue) {
    authHeaders['Authorization'] = `Basic ${config.authValue}`;
  }

  if (Object.keys(authHeaders).length > 0) {
    suite.defaultHeaders = { ...suite.defaultHeaders, ...authHeaders };
  }

  // Cho phép domain ngoài localhost nếu baseUrl là external
  const parsedUrl = new URL(config.baseUrl);
  const isExternal = !['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname);
  if (isExternal) {
    suite.security = {
      allowExternalHosts: true,
      blockProductionLikeHosts: false,
      allowedHostnames: [parsedUrl.hostname],
    };
  }

  // Lưu file kế hoạch test
  const runDir = path.join(
    process.cwd(),
    'artifacts',
    'runs',
    `api_${Date.now()}`,
  );
  fs.mkdirSync(runDir, { recursive: true });

  const planPath = writeApiTestSuiteArtifact(
    suite,
    path.join(runDir, 'api-test-plan.json'),
  );

  // Hiển thị Oracle Gate
  const gate = computeApiOracleGate(suite.tests);
  const gateIcon: Record<string, string> = {
    READY_SPECIFICATION: '🟢',
    READY_CHARACTERIZATION: '🟡',
    NEEDS_ORACLE: '🔴',
  };

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  📊 BÁO CÁO TRƯỚC KHI CHẠY TEST');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Tổng test cases:   ${suite.tests.length}`);
  console.log(`  Oracle Gate:       ${gateIcon[gate.gateStatus] || '⚪'} ${gate.gateStatus}`);
  console.log(`   └─ Specification: ${gate.specificationCount} tests`);
  console.log(`   └─ Needs Oracle:  ${gate.needsOracleCount} tests`);
  console.log(`  Kế hoạch test:     ${planPath}`);
  console.log('');

  // In 5 test case mẫu
  console.log('  📋 Mẫu test cases sẽ chạy:');
  suite.tests.slice(0, 5).forEach((tc, i) => {
    const statusAssert = tc.assertions.find(a => a.type === 'STATUS');
    const code = statusAssert && 'expected' in statusAssert ? statusAssert.expected : '?';
    console.log(`   ${i + 1}. [${tc.request.method}] ${tc.request.path} → ${code}`);
  });
  if (suite.tests.length > 5) {
    console.log(`   ... và ${suite.tests.length - 5} test cases nữa`);
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🚀 Đang gửi HTTP requests thật và đánh giá kết quả...');
  console.log(`     → ${config.baseUrl}`);
  if (config.authType !== 'none') {
    console.log(`     🔐 Auth: ${config.authType.toUpperCase()}`);
  }
  console.log('');

  const startTime = Date.now();
  let result;
  try {
    result = await runApiTestSuite(suite);
  } catch (error: any) {
    console.error(`  ❌ Lỗi nghiêm trọng khi chạy test: ${error.message}`);
    return;
  }

  const elapsed = Date.now() - startTime;

  // ── Kết quả ──────────────────────────────────────────────────────────────
  const { markdownPath, htmlPath, junitPath } = writeApiRunArtifacts(result, suite, runDir);

  // Lưu bản sao báo cáo mới nhất ra thư mục artifacts gốc để tiện mở
  try {
    fs.copyFileSync(htmlPath, path.join(process.cwd(), 'artifacts', 'api-test-report.html'));
  } catch {}

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ${result.ok ? '✅ TẤT CẢ TEST PASSED!' : '❌ CÓ TEST FAILED'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Tổng:     ${result.totalTests} tests`);
  console.log(`  ✅ Passed: ${result.passedTests}`);
  console.log(`  ❌ Failed: ${result.failedTests}`);
  if (result.specificationFailures > 0) {
    console.log(`  ⚠️  SPECIFICATION Failures: ${result.specificationFailures} (Khả năng cao là Application Bug!)`);
  }
  console.log(`  Thời gian: ${elapsed}ms`);
  console.log('');

  // Liệt kê các test fail
  if (result.failedTests > 0) {
    console.log('  ── Test bị fail ──────────────────────────────────────');
    result.tests.filter(t => !t.ok).forEach(t => {
      const oracleTag = t.oracle ? `[${t.oracle.intentType}]` : '[NO_ORACLE]';
      const reason = t.error
        || t.assertions.find(a => !a.ok)?.message
        || 'Unknown';
      console.log(`  ❌ ${t.id} ${oracleTag}`);
      console.log(`     ${t.request.method} ${t.request.url}`);
      console.log(`     → ${reason}`);
      console.log('');
    });
  }

  console.log(`  📄 Báo cáo Markdown:       ${markdownPath}`);
  console.log(`  🌐 Báo cáo HTML trực quan:  file:///${htmlPath.replace(/\\/g, '/')}`);
  console.log(`  📑 Báo cáo JUnit XML:      ${junitPath}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}
