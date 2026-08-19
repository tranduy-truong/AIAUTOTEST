import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { OpenAIAdapter } from "../../adapters/openai.js";
import type { ActionPlan, ResolvedAction } from "../../core/action-plan.js";
import { runUnitGenerator } from './unit-generator.js';
import { section } from '../../core/cli-ui.js';
import { generateVitestCodeFromApiTestSuite } from '../../core/integration/api/contract-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MAX_DOM_REPORT_CHARS = 8000;
export const MAX_GENERATOR_FALLBACK_CHARS = 10000;

export function limitDomReport(report: string, maxChars = MAX_DOM_REPORT_CHARS): string {
  if (report.length <= maxChars) return report;
  return `${report.slice(0, maxChars)}\n\n[DOM catalog truncated to stay within the AI token limit.]`;
}

export function getGeneratedTestDirectory(
  level: "unit" | "integration" | "e2e",
  cwd = process.cwd(),
): string {
  return path.join(cwd, "tests", level);
}

export function cleanupLegacyGeneratedE2EOutput(outDir: string): void {
  const legacyGeneratedDir = path.join(outDir, "generated");
  fs.rmSync(legacyGeneratedDir, { recursive: true, force: true });
}

export function slugifyVietnameseFileName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

export function deriveSpecBaseName(testCaseNames: string[], fallback: string): string {
  const tokenGroups = testCaseNames
    .map(name => slugifyVietnameseFileName(name).split('_').filter(Boolean))
    .filter(tokens => tokens.length > 0);

  if (tokenGroups.length === 1) return tokenGroups[0].join('_');
  if (tokenGroups.length > 1) {
    const commonPrefix: string[] = [];
    const shortest = Math.min(...tokenGroups.map(tokens => tokens.length));
    for (let index = 0; index < shortest; index++) {
      const token = tokenGroups[0][index];
      if (!tokenGroups.every(tokens => tokens[index] === token)) break;
      commonPrefix.push(token);
    }
    if (commonPrefix.length >= 2) return commonPrefix.join('_');
    return `tong_hop_${tokenGroups[0].slice(0, 5).join('_')}`;
  }

  return slugifyVietnameseFileName(fallback) || 'kiem_thu_e2e';
}

export function createDatedUniqueSpecPath(
  outDir: string,
  testCaseNames: string[],
  fallback: string,
  extension = '.spec.ts',
  now = new Date(),
): string {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('_');
  const baseName = `${deriveSpecBaseName(testCaseNames, fallback)}_${date}`;
  let candidate = path.join(outDir, `${baseName}${extension}`);
  let version = 2;

  while (fs.existsSync(candidate)) {
    candidate = path.join(outDir, `${baseName}_${String(version).padStart(2, '0')}${extension}`);
    version++;
  }

  return candidate;
}

function testCaseNamesForContent(content: string, plan?: ActionPlan): string[] {
  if (!plan) return [];
  const ids = new Set(
    [...content.matchAll(/\bTC(?:_[A-Z0-9]+)+\b/gi)]
      .map(match => match[0].toUpperCase()),
  );
  const matched = plan.testCases
    .filter(testCase => ids.has(testCase.id.toUpperCase()))
    .map(testCase => testCase.name);
  return matched.length > 0 ? matched : plan.testCases.map(testCase => testCase.name);
}

function loadVerifiedActionPlan(level: "unit" | "integration" | "e2e"): ActionPlan | undefined {
  if (level !== "e2e" || !fs.existsSync("artifacts/action-plan.json")) return undefined;

  try {
    return JSON.parse(fs.readFileSync("artifacts/action-plan.json", "utf-8")) as ActionPlan;
  } catch (error) {
    console.warn(`   Không đọc được Action Plan đã xác minh: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return undefined;
  }
}

function readPlannerNames(rawPlan: string): Map<string, string> {
  if (!rawPlan) return new Map();
  try {
    const parsed = JSON.parse(rawPlan) as { testCases?: Array<{ id?: string; name?: string }> };
    return new Map(
      (parsed.testCases || [])
        .filter(testCase => testCase.id && testCase.name)
        .map(testCase => [testCase.id!.toUpperCase(), testCase.name!]),
    );
  } catch {
    return new Map();
  }
}

function compactAgentContract(plan: ActionPlan, structuredPlannerPlan = ''): string {
  const plannerNames = readPlannerNames(structuredPlannerPlan);
  return JSON.stringify({
    contract: 'planner-generator-crawler-v1',
    testCases: plan.testCases.map(testCase => ({
      id: testCase.id,
      name: plannerNames.get(testCase.id.toUpperCase()) || testCase.name,
      actions: testCase.actions.map(action => ({
        stepIndex: action.stepIndex,
        type: action.type,
        playwrightCode: action.playwrightCode,
        confidence: action.confidence,
      })),
    })),
  });
}

function compactStructuredPlannerPlan(rawPlan: string): string {
  if (!rawPlan) return '';
  try {
    const parsed = JSON.parse(rawPlan) as {
      testCases?: Array<{
        id?: string;
        name?: string;
        url?: string;
        steps?: Array<Record<string, unknown>>;
      }>;
    };
    return JSON.stringify({
      contract: 'planner-generator-v1',
      testCases: (parsed.testCases || []).map(testCase => ({
        id: testCase.id,
        name: testCase.name,
        url: testCase.url,
        steps: (testCase.steps || []).map(step => ({
          stepIndex: step.stepIndex,
          type: step.type,
          target: step.target,
          value: step.value,
          url: step.url,
          context: step.context,
          sourceLine: step.sourceLine,
          assertions: step.assertions,
        })),
      })),
    });
  } catch {
    return '';
  }
}

export function buildGeneratorContext(options: {
  testPlan: string;
  structuredPlannerPlan?: string;
  verifiedActionPlan?: ActionPlan;
  sourceScript?: string;
  crawledDomData?: string;
}): string {
  if (options.verifiedActionPlan) {
    return `[HỢP ĐỒNG ĐÃ HỢP NHẤT TỪ PLANNER VÀ CRAWLER - PLAYWRIGHT CODE LÀ BẮT BUỘC]:\n${compactAgentContract(
      options.verifiedActionPlan,
      options.structuredPlannerPlan,
    )}`;
  }

  const structured = compactStructuredPlannerPlan(options.structuredPlannerPlan || '');
  if (structured) {
    return `[TEST PLAN CÓ CẤU TRÚC DO PLANNER XUẤT RA]:\n${structured}\n${options.crawledDomData || ''}`;
  }

  const fallback = [options.testPlan, options.sourceScript, options.crawledDomData]
    .filter(Boolean)
    .join('\n\n');
  return `[NGỮ CẢNH E2E DỰ PHÒNG]:\n${limitDomReport(fallback, MAX_GENERATOR_FALLBACK_CHARS)}`;
}

export async function runGenerator(
  level: "unit" | "integration" | "e2e",
  targetFileName = "e2e_test_suite",
  options?: { exactFilePath?: string },
): Promise<string | boolean> {
  if (level === 'unit') {
    section('02', 'Generator', 'Biên dịch Test Intent thành Vitest theo quy tắc xác định');
    return runUnitGenerator();
  }

  console.log(
    `\n👨‍💻 [Generator Agent] Đang sinh code kiểm thử cho tầng: ${level.toUpperCase()}`,
  );

  if (level === 'integration' && fs.existsSync('artifacts/api-test-plan.json')) {
    try {
      const suiteObj = JSON.parse(fs.readFileSync('artifacts/api-test-plan.json', 'utf-8'));
      if (suiteObj && suiteObj.tests && Array.isArray(suiteObj.tests)) {
        console.log(`\n📋 [OpenAPI Code Generator] Đang sinh mã kiểm thử Vitest cho ${suiteObj.tests.length} API endpoints...`);
        const codeContent = generateVitestCodeFromApiTestSuite(suiteObj);

        const outDir = getGeneratedTestDirectory('integration');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        const targetFilePath = path.join(outDir, 'api_generated.test.ts');
        fs.writeFileSync(targetFilePath, codeContent);

        console.log(`✅ [OpenAPI Code Generator] Đã sinh thành công mã kiểm thử Vitest!`);
        console.log(`📁 File test đã lưu tại: tests/integration/api_generated.test.ts`);
        console.log(`👉 Bây giờ bạn có thể chọn Menu 03 để thực thi bộ test này!`);
        return true;
      }
    } catch (err: any) {
      console.warn(`⚠️ Lỗi khi sinh code từ api-test-plan.json: ${err.message}. Chuyển sang AI Generator...`);
    }
  }

  // 1. Kiểm tra kế hoạch từ file JSON
  const preferredPlanPath = level === 'e2e'
    ? 'artifacts/test-plan-e2e.md'
    : `artifacts/test-plan-${level}.json`;
  const legacyPlanPath = `artifacts/test-plan-${level}.json`;
  const planPath = fs.existsSync(preferredPlanPath) ? preferredPlanPath : legacyPlanPath;
  if (!fs.existsSync(planPath)) {
    console.error(`❌ Không tìm thấy ${planPath}. Hãy chạy Planner trước!`);
    return false;
  }

  const testPlan = fs.readFileSync(planPath, "utf-8");
  const structuredPlannerPlan = level === 'e2e' && fs.existsSync('artifacts/test-plan-e2e.json')
    ? fs.readFileSync('artifacts/test-plan-e2e.json', 'utf-8')
    : '';

  let sourceScript = '';
  if (level === 'e2e' && fs.existsSync('artifacts/source-script-e2e.md')) {
    sourceScript = fs.readFileSync('artifacts/source-script-e2e.md', 'utf-8');
  }
  const verifiedActionPlan = loadVerifiedActionPlan(level);

  // 2. Cấu hình Framework đích (Playwright hay Vitest)
  let framework = "";
  let fileExtension = "";
  if (level === "integration") {
    framework = "Vitest (import { describe, it, expect } from 'vitest')";
    fileExtension = ".test.ts";
  } else {
    framework = "Playwright (import { test, expect } from '@playwright/test')";
    fileExtension = ".spec.ts";
  }

  // 3. Đọc kịch bản file .md của Generator
  const promptFileName = `prompt-${level}.md`;
  const promptFilePath = path.join(__dirname, promptFileName);

  let systemPrompt = "";
  if (fs.existsSync(promptFilePath)) {
    systemPrompt = fs.readFileSync(promptFilePath, "utf-8");
  } else {
    console.error(
      `❌ Không tìm thấy file kịch bản của Generator: ${promptFilePath}`,
    );
    return false;
  }

  // Đọc DOM data nếu có từ crawler
  let crawledDomData = "";
  if (!verifiedActionPlan && fs.existsSync("artifacts/crawled-dom.md")) {
    const domReport = limitDomReport(fs.readFileSync("artifacts/crawled-dom.md", "utf-8"));
    crawledDomData =
      `\n\n[BÁO CÁO CRAWLED DOM THỰC TẾ - BẮT BUỘC DÙNG CHÍNH XÁC CÁC LOCATOR NÀY]:\n` +
      domReport;
  }

  const generatorContext = level === 'e2e'
    ? buildGeneratorContext({
        testPlan,
        structuredPlannerPlan,
        verifiedActionPlan,
        sourceScript,
        crawledDomData,
      })
    : testPlan;

  const prompt = `
${systemPrompt}

Bạn là chuyên gia tự động hóa kiểm thử. Dựa vào bản Test Plan dưới đây, hãy viết code test hoàn chỉnh bằng ${framework}.

[NGỮ CẢNH DUY NHẤT]:
${generatorContext}

[QUY TẮC QUAN TRỌNG - PHẢI TUÂN THỦ TUYỆT ĐỐI]:
1. Kịch bản gốc quyết định chính xác thứ tự bước, dữ liệu nhập và assertion; Test Plan chỉ bổ sung ý nghĩa nghiệp vụ.
2. Nếu có ACTION PLAN ĐÃ ĐƯỢC CRAWLER XÁC MINH, PHẢI chép đúng playwrightCode cho từng action; CẤM thay bằng locator khác.
3. TUYỆT ĐỐI KHÔNG tự đoán class theo thư viện UI như .lucide-eye, .fa-edit hoặc [class*=eye] nếu DOM không cung cấp class đó.
4. Đối với assertion kiểm tra hiển thị Text: Bắt buộc dùng \`page.getByText('...', { exact: true }).first()\` để tránh lỗi \`Strict mode violation\` khi text xuất hiện ở nhiều phần tử.
5. Đối với thao tác Click Tab hoặc Nút: Sử dụng đúng ARIA role tab nếu là tab điều hướng (\`getByRole('tab')\`) hoặc fallback \`.or(page.getByRole('button', ...)).or(page.getByText(...)).first()\`.
6. Nếu không có locator duy nhất được xác minh, đánh dấu test bằng test.fixme(true, 'Không có locator được xác minh cho ...') thay vì sinh locator đoán mò.
7. Nhóm các test case theo MODULE thành các file riêng biệt.
8. Mỗi file bắt đầu bằng dòng đánh dấu: // FILE: <tên-file>${fileExtension}
9. Mỗi file chỉ được có DUY NHẤT MỘT dòng import ở đầu file.
10. TUYỆT ĐỐI KHÔNG lặp lại dòng import ở giữa hoặc cuối file.
11. Toàn bộ nội dung nằm trong một khối \`\`\`typescript ... \`\`\`.

[VÍ DỤ ĐỊNH DẠNG ĐẦU RA - TUÂN THEO CHÍNH XÁC]:
\`\`\`typescript
// FILE: login${fileExtension}
import { test, expect } from '@playwright/test';

test.describe('Login', () => {
  test('TC_LOGIN_01 - ...', async ({ page }) => {
    // test steps
  });
});

// FILE: product${fileExtension}
import { test, expect } from '@playwright/test';

test.describe('Product', () => {
  test('TC_PRODUCT_01 - ...', async ({ page }) => {
    // test steps
  });
});
\`\`\`
  `;

  console.log(`   Kích thước prompt Generator: ${prompt.length.toLocaleString('vi-VN')} ký tự`);

  // 4. Gọi AI
  const runId = `run_${Date.now()}`;
  const workDir = path.join(process.cwd(), ".testkit", "runs", runId);
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, "task.md"), prompt.trim());

  const adapter = new OpenAIAdapter();

  const result = await adapter.run({
    promptDir: workDir,
    workDir,
    timeoutMs: 120000,
    maxTokens: undefined,
  });

  // 5. Trích xuất code và ghi ra thư mục đích
  if (result.ok) {
    const codeMatch = result.rawOutput.match(
      /```(?:typescript|ts|javascript|js)?\n?([\s\S]*?)```/,
    );
    const codeContent = codeMatch
      ? codeMatch[1].trim()
      : result.rawOutput.trim();

    const outDir = getGeneratedTestDirectory(level);
    // Chỉ dọn cấu trúc generated/ cũ. Các file spec đã sinh là lịch sử kiểm
    // thử của tester và không được xóa hoặc ghi đè.
    if (level === "e2e") {
      cleanupLegacyGeneratedE2EOutput(outDir);
    }
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const displayOutDir = path.relative(process.cwd(), outDir).replace(/\\/g, "/");

    // 6. Tách nhiều file nếu AI dùng marker "// FILE: ..."
    const fileMarkerRegex = /\/\/ FILE:\s*(\S+)/g;
    const markers: { name: string; index: number }[] = [];
    let match;

    while ((match = fileMarkerRegex.exec(codeContent)) !== null) {
      markers.push({ name: match[1], index: match.index });
    }

    if (markers.length > 1) {
      // Trường hợp AI sinh nhiều file → tách ra từng file riêng
      console.log(`\n📂 Phát hiện ${markers.length} file spec, đang tách...`);
      const savedFiles: string[] = [];

      for (let i = 0; i < markers.length; i++) {
        const start = markers[i].index;
        const end = i + 1 < markers.length ? markers[i + 1].index : undefined;
        let fileContent = codeContent.slice(start, end).trim();

        // Lấy tên file từ marker, làm sạch ký tự không hợp lệ cho tên file Windows (< > : " / \ | ? * `)
        let fileName = markers[i].name.replace(/[<>:"/\\|?*`']/g, "").trim();

        // Nếu tên file chứa placeholder mẫu (<name>, tên-file, filename) hoặc timestamp ngẫu nhiên, đổi thành tên tường minh
        if (
          !fileName ||
          /name|tên-file|filename|test_e2e_\d+|run_\d+/i.test(fileName)
        ) {
          fileName = `${targetFileName}_${i + 1}`;
        }

        // Đảm bảo không bị lặp đuôi extension (vd .spec.ts.spec.ts)
        fileName = fileName.replace(/(\.(spec|test))?(\.(ts|js))+$/i, "");
        fileName = `${fileName}${fileExtension}`;
        // Xóa dòng // FILE: ... khỏi nội dung file
        fileContent = fileContent.replace(/^\/\/ FILE:.*\n?/, "").trim();

        // ★ BUG-FIX: Skip file rỗng — không ghi file trắng 1 byte
        if (!fileContent || fileContent.length < 10) {
          console.warn(`  ⚠️ Bỏ qua fragment ${i + 1}/${markers.length} vì nội dung rỗng.`);
          continue;
        }

        // ★ POST-PROCESSING: Sửa lỗi phổ biến trước khi ghi file
        fileContent = fixCommonPlaywrightIssues(fileContent, verifiedActionPlan);

        // ★ BUG-FIX: exactFilePath chỉ được dùng cho fragment đầu tiên (i=0).
        // Các fragment còn lại PHẢI tạo file mới theo tên marker — không được
        // ghi đè lẫn nhau vào cùng 1 path làm mất nội dung.
        const filePath = (i === 0 && options?.exactFilePath)
          ? options.exactFilePath
          : level === 'e2e'
            ? createDatedUniqueSpecPath(
                outDir,
                testCaseNamesForContent(fileContent, verifiedActionPlan),
                fileName,
                fileExtension,
              )
            : path.join(outDir, fileName);
        fs.writeFileSync(filePath, fileContent + "\n");
        savedFiles.push(filePath);
        console.log(`  ✅ Đã tạo/cập nhật: ${filePath}`);
      }

      if (savedFiles.length === 0) {
        console.error(`❌ Không có file spec nào được ghi — tất cả fragments đều rỗng!`);
        return false;
      }

      console.log(
        `\n✅ Sinh code thành công! ${savedFiles.length} file lưu tại: ${displayOutDir}/`,
      );
      // Trả về path của file đầu tiên thực sự được ghi (không nhất thiết là savedFiles[0] nếu i=0 bị skip)
      return savedFiles[0].replace(/\\/g, '/');
    } else {
      // Trường hợp AI chỉ sinh 1 file (hoặc không dùng marker)
      // Xóa dòng "// FILE: ..." nếu có, rồi lưu vào 1 file
      let cleanedContent = codeContent.replace(/^\/\/ FILE:.*\n?/gm, "").trim();

      // ★ POST-PROCESSING: Sửa lỗi phổ biến trước khi ghi file
      cleanedContent = fixCommonPlaywrightIssues(cleanedContent, verifiedActionPlan);

      let cleanTargetName = targetFileName
        .replace(/[<>:"/\\|?*`']/g, "")
        .trim();
      cleanTargetName = cleanTargetName.replace(
        /(\.(spec|test))?(\.(ts|js))+$/i,
        "",
      );

      const filePath = options?.exactFilePath
        ? options.exactFilePath
        : level === 'e2e'
          ? createDatedUniqueSpecPath(
              outDir,
              testCaseNamesForContent(cleanedContent, verifiedActionPlan),
              cleanTargetName,
              fileExtension,
            )
          : path.join(outDir, `${cleanTargetName}${fileExtension}`);
      fs.writeFileSync(filePath, cleanedContent + "\n");
      console.log(`✅ Đã sinh/cập nhật code thành công! File lưu tại: ${filePath}`);
      return filePath.replace(/\\/g, '/');
    }
  } else {
    console.error(`❌ Lỗi khi Generator chạy:`, result.rawOutput);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// ★ POST-PROCESSING ENGINE: Tự động sửa các lỗi phổ biến của AI
//   trước khi ghi file — KHÔNG phụ thuộc vào LLM "nghe lời"
// ═══════════════════════════════════════════════════════════════════
function normalizedTestId(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function numericTestSuffix(value: string): string | undefined {
  return value.match(/(\d+)$/)?.[1]?.replace(/^0+(?=\d)/, '');
}

function findPlannedTestCase(id: string, actionPlan: ActionPlan) {
  const exact = actionPlan.testCases.find(testCase =>
    normalizedTestId(testCase.id) === normalizedTestId(id),
  );
  if (exact) return exact;

  const suffix = numericTestSuffix(id);
  if (!suffix) return undefined;
  const candidates = actionPlan.testCases.filter(testCase => numericTestSuffix(testCase.id) === suffix);
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Generator remains an Agent, but its free-form output may not override the
 * Planner/Crawler contract. For complete E2E plans, rebuild each generated
 * test body from verified actions while preserving the LLM-created suite/file
 * structure and readable test title.
 */
export function enforceVerifiedActionPlan(
  code: string,
  actionPlan?: ActionPlan,
): { code: string; changed: boolean } {
  if (!actionPlan) return { code, changed: false };

  const lines = code.split('\n');
  let changed = false;

  for (let start = 0; start < lines.length; start++) {
    if (!/^\s*test\s*\(/.test(lines[start])) continue;
    const generatedId = lines[start].match(/\bTC(?:_[A-Z0-9]+)+\b/i)?.[0];
    if (!generatedId) continue;
    const testCase = findPlannedTestCase(generatedId, actionPlan);
    if (!testCase || testCase.actions.length === 0) continue;

    // A complete script-mode Action Plan starts with navigation. Partial plans
    // used by targeted post-processors must not erase unrelated generated code.
    if (testCase.actions[0].type !== 'goto') continue;

    const startIndent = lines[start].match(/^\s*/)?.[0] || '';
    let end = start + 1;
    for (; end < lines.length; end++) {
      const indent = lines[end].match(/^\s*/)?.[0] || '';
      if (indent === startIndent && /^\s*}\);\s*$/.test(lines[end])) break;
    }
    if (end >= lines.length) continue;

    const bodyIndent = `${startIndent}  `;
    const unresolved = testCase.actions.find(action => action.confidence === 'low');
    const replacement: string[] = [];
    if (unresolved) {
      const reason = `Bước ${unresolved.stepIndex} chưa được Planner/Crawler xác minh`;
      replacement.push(`${bodyIndent}test.fixme(true, '${reason}');`);
    } else {
      for (const action of testCase.actions) {
        if (action.description) {
          const description = action.description.replace(/^[-*•·▪◦–—]\s*/u, '').replace(/[\r\n]+/g, ' ');
          replacement.push(`${bodyIndent}// ${description}`);
        }
        for (const actionLine of action.playwrightCode.split('\n')) {
          if (actionLine.trim()) replacement.push(`${bodyIndent}${actionLine.trim()}`);
        }
      }
    }

    lines.splice(start + 1, end - start - 1, ...replacement);
    changed = true;
    start += replacement.length;
  }

  return { code: lines.join('\n'), changed };
}

function fixPasswordToggleAssertions(code: string): { code: string; changed: boolean } {
  const lines = code.split('\n');
  const testStarts = lines
    .map((line, index) => (/^\s*test\s*\(/.test(line) ? index : -1))
    .filter(index => index >= 0);
  let changed = false;

  for (let testPosition = 0; testPosition < testStarts.length; testPosition++) {
    const start = testStarts[testPosition];
    const end = testStarts[testPosition + 1] ?? lines.length;
    const titleLine = lines[start]
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    if (!/(an\s*\/\s*hien\s+mat\s+khau|icon\s+con\s+mat|password.*visibility|show.*hide.*password)/i.test(titleLine)) {
      continue;
    }

    const fillIndex = lines.findIndex((line, index) =>
      index >= start &&
      index < end &&
      /(?:mat khau|mật khẩu|password)/i.test(line) &&
      /\.fill\(/.test(line),
    );
    if (fillIndex < 0) continue;

    const clickIndices: number[] = [];
    for (let index = fillIndex + 1; index < end; index++) {
      if (/\.click\(/.test(lines[index])) clickIndices.push(index);
    }

    clickIndices.forEach((clickIndex, clickPosition) => {
      const assertionEnd = clickIndices[clickPosition + 1] ?? end;
      const assertionLines = lines.slice(clickIndex + 1, assertionEnd);
      if (assertionLines.some(line => /toHaveAttribute\(\s*['"]type['"]/.test(line))) return;

      const wrongOffset = assertionLines.findIndex(line =>
        /(?:mat khau|mật khẩu|password)/i.test(line) &&
        /\.(?:not\.)?toHaveValue\(/.test(line),
      );
      if (wrongOffset < 0) return;

      const wrongIndex = clickIndex + 1 + wrongOffset;
      const match = lines[wrongIndex].match(/^(\s*)await\s+expect\((.+)\)\.(?:not\.)?toHaveValue\([^;]*\);?\s*$/);
      if (!match) return;

      const expectedType = clickPosition % 2 === 0 ? 'text' : 'password';
      lines[wrongIndex] = `${match[1]}await expect(${match[2]}).toHaveAttribute('type', '${expectedType}');`;
      changed = true;
    });
  }

  return { code: lines.join('\n'), changed };
}

function normalizeForMatching(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd');
}

function isPasswordToggleAction(action: ResolvedAction): boolean {
  if (action.type !== 'click' || action.confidence === 'low') return false;
  const description = normalizeForMatching(action.description);
  return description.includes('con mat') || description.includes('eye') || description.includes('an/hien mat khau');
}

function fixPasswordToggleLocators(
  code: string,
  actionPlan?: ActionPlan,
): { code: string; changed: boolean } {
  if (!actionPlan) return { code, changed: false };

  const lines = code.split('\n');
  const testStarts = lines
    .map((line, index) => (/^\s*test\s*\(/.test(line) ? index : -1))
    .filter(index => index >= 0);
  let changed = false;

  for (let position = 0; position < testStarts.length; position++) {
    const start = testStarts[position];
    const end = testStarts[position + 1] ?? lines.length;
    const id = lines[start].match(/\bTC_\d+\b/i)?.[0].toUpperCase();
    if (!id) continue;

    const testCase = actionPlan.testCases.find(candidate => candidate.id.toUpperCase() === id);
    if (!testCase) continue;
    const verifiedToggleClicks = testCase.actions.filter(isPasswordToggleAction);
    if (verifiedToggleClicks.length === 0) continue;

    const guessedToggleLines: number[] = [];
    const allClickLines: number[] = [];
    for (let index = start + 1; index < end; index++) {
      if (!/\.click\(/.test(lines[index])) continue;
      allClickLines.push(index);
      const normalizedLine = normalizeForMatching(lines[index]);
      if (
        (normalizedLine.includes('con mat') || normalizedLine.includes('eye')) &&
        /(getByRole|getByText|getByLabel)/.test(lines[index])
      ) {
        guessedToggleLines.push(index);
      }
    }

    guessedToggleLines.forEach((lineIndex, clickIndex) => {
      const verifiedAction = verifiedToggleClicks[clickIndex];
      if (!verifiedAction) return;
      const indent = lines[lineIndex].match(/^\s*/)?.[0] || '';
      lines[lineIndex] = `${indent}${verifiedAction.playwrightCode.trim()}`;
      changed = true;
    });

    const plannedClickCount = testCase.actions.filter(action => action.type === 'click').length;
    let extraClickCount = Math.max(0, allClickLines.length - plannedClickCount);
    for (const lineIndex of allClickLines) {
      if (extraClickCount === 0) break;
      const normalizedLine = normalizeForMatching(lines[lineIndex]);
      if (/(passwordinput|mat khau|password).*\.click\(/.test(normalizedLine)) {
        lines[lineIndex] = '';
        extraClickCount--;
        changed = true;
      }
    }
  }

  return { code: lines.join('\n'), changed };
}

function fixDuplicateLoginsInTestBlock(code: string): { code: string; changed: boolean } {
  const lines = code.split('\n');
  const testStarts = lines
    .map((line, index) => (/^\s*test\s*\(/.test(line) ? index : -1))
    .filter(index => index >= 0);
  let changed = false;

  for (let position = 0; position < testStarts.length; position++) {
    const start = testStarts[position];
    const end = testStarts[position + 1] ?? lines.length;

    let loginCount = 0;
    let inDuplicateLogin = false;

    for (let i = start + 1; i < end; i++) {
      const line = lines[i];
      const normalizedLine = line.toLowerCase();

      // Nhận diện bước mở trang đăng nhập
      if (/(?:goto.*(?:dang-nhap|login|signin)|getByPlaceholder.*(?:ten dang nhap|username|tai khoan))/i.test(normalizedLine)) {
        if (/goto.*(?:dang-nhap|login|signin)/i.test(normalizedLine)) {
          loginCount++;
          if (loginCount > 1) {
            inDuplicateLogin = true;
          }
        }
      }

      if (inDuplicateLogin) {
        // Kiểm tra xem dòng này có phải là 1 phần của cụm đăng nhập lặp lại không
        if (
          /(?:dang-nhap|login|username|password|mat khau|ten dang nhap|waitForURL.*dang-nhap|not\.toHaveURL.*dang-nhap|\/\/\s*(?:mở trang đăng nhập|nhập tên đăng nhập|nhập mật khẩu|bấm nút đăng nhập|kiểm tra url không còn chứa dang-nhap))/i.test(normalizedLine) ||
          /await page\.(getByPlaceholder|getByRole\('button', \{\s*name:\s*['"]Đăng nhập['"])/i.test(line)
        ) {
          lines[i] = ''; // Xóa dòng đăng nhập trùng lặp
          changed = true;
          continue;
        } else if (/await page\.goto\(/.test(line) || /await expect\(/.test(line) || /await page\.getBy/.test(line)) {
          // Gặp lệnh nghiệp vụ mới -> kết thúc khối duplicate login
          inDuplicateLogin = false;
        }
      }
    }
  }

  // Lọc bớt các dòng trống liên tiếp sinh ra sau khi xóa
  const cleanedLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '' && cleanedLines[cleanedLines.length - 1] === '') continue;
    cleanedLines.push(lines[i]);
  }

  return { code: cleanedLines.join('\n'), changed };
}

export function fixCommonPlaywrightIssues(code: string, actionPlan?: ActionPlan): string {
  let fixed = code;
  const fixes: string[] = [];

  // ── FIX 0: Dọn dẹp lời thoại chat rác (Preamble & Markdown Cleanup) ──
  if (
    /^(Let me|Here is|Below is|Sure, here|I will write|This is)/im.test(
      fixed,
    ) ||
    fixed.includes("```")
  ) {
    fixed = fixed
      .replace(/^(Let me|Here is|Below is|Sure,|I will|This is).*$/gm, "")
      .replace(/```(?:typescript|ts|javascript|js)?/g, "")
      .replace(/```/g, "")
      .trim();
    fixes.push("FIX-0: Dọn dẹp lời thoại rác & markdown code fences từ model");
  }

  const verifiedPlanResult = enforceVerifiedActionPlan(fixed, actionPlan);
  if (verifiedPlanResult.changed) {
    fixed = verifiedPlanResult.code;
    fixes.push('FIX-14: Dựng lại test body từ Planner/Crawler Action Plan đã xác minh');
  }

  const passwordLocatorResult = fixPasswordToggleLocators(fixed, actionPlan);
  if (passwordLocatorResult.changed) {
    fixed = passwordLocatorResult.code;
    fixes.push('FIX-13: Icon ẩn/hiện mật khẩu → locator đã được Crawler xác minh');
  }

  const passwordToggleResult = fixPasswordToggleAssertions(fixed);
  if (passwordToggleResult.changed) {
    fixed = passwordToggleResult.code;
    fixes.push("FIX-12: Ẩn/hiện mật khẩu → kiểm tra type='text'/'password', không kiểm tra value");
  }
  // ── FIX 8: Fix selectOption() on custom dropdowns ──────────────────────
  const selectOptionPattern = /await\s+page\.getByRole\(['"]option['"],\s*\{\s*name:\s*['"](.*?)['"]\s*\}\)\.selectOption\(['"].*?['"]\);?/g;
  if (selectOptionPattern.test(fixed)) {
    fixed = fixed.replace(selectOptionPattern, "await page.getByText('$1').click();");
    fixes.push("FIX-8: getByRole('option').selectOption → getByText().click()");
  }

  // ── FIX 9: Fix strict button name 'Thêm' for '+ Thêm' ─────────────────
  const strictAddButtonPattern = /await\s+page\.getByRole\(['"]button['"],\s*\{\s*name:\s*['"]Thêm['"]\s*\}\)\.click\(\);?/g;
  if (strictAddButtonPattern.test(fixed)) {
    fixed = fixed.replace(strictAddButtonPattern, "await page.getByRole('button', { name: /Thêm/i }).click();");
    fixes.push("FIX-9: getByRole('button', { name: 'Thêm' }) → RegExp /Thêm/i (hỗ trợ nút + Thêm)");
  }

  // ── FIX 10: Strict mode violation fix cho combobox dropdown triggers ──
  const UnscopedFilterPattern = /await\s+page\.locator\(['"]div,\s*span,\s*button['"]\)\.filter\(\{\s*hasText:\s*\/(.*?)\/i?\s*\}\)\.click\(\);?/g;
  if (UnscopedFilterPattern.test(fixed)) {
    fixed = fixed.replace(UnscopedFilterPattern, "await page.getByRole('dialog').getByText('$1').first().click();");
    fixes.push("FIX-10: Scope dropdown trigger vào dialog để tránh 7 elements strict mode violation");
  }

  // ── FIX 11: toContainText trên <input> → toHaveValue (input không có textContent) ──
  // AI hay viết: expect(page.getByPlaceholder('...')).toContainText('...')
  // Đúng:        expect(page.getByPlaceholder('...')).toHaveValue('...')
  const inputContainTextPattern = /await\s+expect\((page\.getByPlaceholder\([^)]+\))\)\.toContainText\((['"][^'"]+['"])\);?/g;
  if (inputContainTextPattern.test(fixed)) {
    fixed = fixed.replace(inputContainTextPattern, "await expect($1).toHaveValue($2);");
    fixes.push("FIX-11: toContainText() trên input → toHaveValue() (input không có textContent)");
  }

  // AI hay viết: expect(page.locator('...').textContent()).toContain('...')
  // Đúng:        await expect(page.locator('...')).toContainText('...')
  const textContentPattern =
    /expect\((.*?)\.textContent\(\)\)\.toContain\(('.*?')\)/g;
  if (textContentPattern.test(fixed)) {
    fixed = fixed.replace(
      textContentPattern,
      "await expect($1).toContainText($2)",
    );
    fixes.push("FIX-1: .textContent().toContain() → .toContainText()");
  }

  // Variant: expect(await locator.textContent()).toContain(...)
  const awaitTextContentPattern =
    /expect\(await\s+(.*?)\.textContent\(\)\)\.toContain\(('.*?')\)/g;
  if (awaitTextContentPattern.test(fixed)) {
    fixed = fixed.replace(
      awaitTextContentPattern,
      "await expect($1).toContainText($2)",
    );
    fixes.push("FIX-1b: expect(await .textContent()) → .toContainText()");
  }

  // ── FIX 2: Strict mode — thêm .first() cho selector khớp nhiều element ──
  const multiElementSelectors = [
    ".oxd-input-group__message",
    ".oxd-input-field-error-message",
    ".invalid-feedback",
    ".error-message",
    ".help-block",
    ".alert-danger",
  ];

  // ── FIX 6: [role="alert"] → dùng getByText() thay vì locator (tránh conflict với __next-route-announcer__) ──
  const roleAlertPattern =
    /await\s+expect\(page\.locator\(\s*['"`]\[role=["']?alert["']?\]['"`]\s*\)\)\.toContainText\(\s*(['"`])(.*?)\1\s*\)/g;
  if (roleAlertPattern.test(fixed)) {
    fixed = fixed.replace(
      roleAlertPattern,
      "await expect(page.getByText($1$2$1)).toBeVisible()",
    );
    fixes.push(
      "FIX-6: locator('[role=alert]').toContainText → getByText().toBeVisible() (tránh strict mode với __next-route-announcer__)",
    );
  }

  for (const sel of multiElementSelectors) {
    // Pattern: page.locator('sel') KHÔNG theo sau bởi .first()/.nth()/.last()
    const escapedSel = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const strictPattern = new RegExp(
      `(page\\.locator\\(['"\`]${escapedSel}['"\`]\\))(?!\\s*\\.(first|nth|last|filter|and)\\()`,
      "g",
    );
    if (strictPattern.test(fixed)) {
      fixed = fixed.replace(strictPattern, "$1.first()");
      fixes.push(`FIX-2: '${sel}' → thêm .first() tránh strict mode violation`);
    }
  }

  // ── FIX 3: Logout ẩn trong dropdown ─────────────────────────────
  // AI hay viết: page.getByText('Logout').click() hoặc getByRole('link', { name: 'Logout' }).click()
  // Đúng: click dropdown trước → rồi mới click Logout
  const logoutPatterns = [
    /await\s+page\.getByText\(['"`]Logout['"`]\)\.click\(\)/g,
    /await\s+page\.getByRole\(['"`]link['"`],\s*\{\s*name:\s*['"`]Logout['"`]\s*\}\)\.click\(\)/g,
    /await\s+page\.locator\(['"`][^'"]*[Ll]ogout[^'"]*['"`]\)\.click\(\)/g,
  ];

  for (const pattern of logoutPatterns) {
    if (pattern.test(fixed)) {
      fixed = fixed.replace(
        pattern,
        `await page.locator('.oxd-userdropdown-tab').click();\n    await page.getByRole('menuitem', { name: 'Logout' }).click()`,
      );
      fixes.push(
        "FIX-3: Logout ẩn trong dropdown → thêm bước click dropdown trước",
      );
    }
  }

  // ── FIX 4: toHaveURL đoán mò dashboard → not.toHaveURL(login/dang-nhap) ──
  // AI hay đoán: toHaveURL(/.*dashboard.*/i) hoặc toHaveURL('.../dashboard')
  // Đúng cho mọi trang: expect(page).not.toHaveURL(/.*(dang-nhap|login).*/i)
  const dashboardUrlPattern =
    /\.toHaveURL\(\s*(\/.*dashboard.*\/i|['"`].*dashboard.*['"`])\s*\)/g;
  if (dashboardUrlPattern.test(fixed)) {
    fixed = fixed.replace(
      dashboardUrlPattern,
      ".not.toHaveURL(/.*(dang-nhap|login).*/i)",
    );
    fixes.push(
      "FIX-4: toHaveURL(/.*dashboard.*/) → .not.toHaveURL(/.*(dang-nhap|login).*/i) (Tự động phát hiện rời trang login)",
    );
  }

  // ── FIX 5: Thiếu await trước expect() ──────────────────────────
  // AI hay viết: expect(page.locator('...')).toContainText('...');
  // Đúng: await expect(page.locator('...')).toContainText('...');
  const missingAwaitPattern =
    /(?<!\bawait\s)expect\((page\.[^)]+)\)\.(toContainText|toHaveText|toHaveURL|toBeVisible|toBeHidden|toBeEnabled|toBeDisabled|toHaveValue|toHaveAttribute)\(/g;
  if (missingAwaitPattern.test(fixed)) {
    fixed = fixed.replace(missingAwaitPattern, "await expect($1).$2(");
    fixes.push("FIX-5: Thiếu await trước expect() → đã thêm");
  }

  // ── FIX 15: Đảm bảo cú pháp đóng test block hợp lệ (tránh SyntaxError khi AI xuất dở) ──
  const openBraces = (fixed.match(/\{/g) || []).length;
  const closeBraces = (fixed.match(/\}/g) || []).length;
  if (openBraces > closeBraces) {
    const lines = fixed.split('\n');
    const lastLine = lines[lines.length - 1].trim();
    if (lastLine && !lastLine.endsWith(';') && !lastLine.endsWith('}')) {
      lines.pop(); // Bỏ dòng dở dang
    }
    fixed = lines.join('\n');
    const curOpen = (fixed.match(/\{/g) || []).length;
    let curClose = (fixed.match(/\}/g) || []).length;
    while (curOpen > curClose) {
      fixed += '\n  });';
      curClose++;
    }
    fixes.push("FIX-15: Tự động hoàn thiện các dấu đóng test block còn dở dang");
  }

  // ── FIX 16: Tự động thêm .first() vào getByText assertion để tránh lỗi Strict Mode Violation ──
  // Biến: expect(page.getByText('...')).toBeVisible() -> expect(page.getByText('...').first()).toBeVisible()
  const unscopedGetByTextPattern = /(expect\(\s*(?:await\s+)?page\.getByText\([^)]+\))(?!\s*\.\s*(first|last|nth))\s*\)\.toBeVisible\(\s*\)/g;
  if (unscopedGetByTextPattern.test(fixed)) {
    fixed = fixed.replace(unscopedGetByTextPattern, "$1.first()).toBeVisible()");
    fixes.push("FIX-16: getByText().toBeVisible() → getByText().first().toBeVisible() (Tránh lỗi Strict Mode Violation)");
  }

  // ── FIX 18: Loại bỏ các bước đăng nhập trùng lặp (>1 lần) trong cùng một testcase ──
  const duplicateLoginResult = fixDuplicateLoginsInTestBlock(fixed);
  if (duplicateLoginResult.changed) {
    fixed = duplicateLoginResult.code;
    fixes.push("FIX-18: Loại bỏ các bước đăng nhập trùng lặp (>1 lần) trong cùng một testcase");
  }

  // ── FIX 19: Tự động chuyển đổi các nút Tab sang Fallback Selector (.or) toàn diện ──
  // 19a. Dựa trên tên tab nghiệp vụ phổ biến
  const tabNamesList = "Thông tin chung|Quá trình thay đổi|Lịch sử thay đổi|Chi tiết cơ sở|Thông tin cơ sở|Chức việc|Chức sắc|Nhà tu hành|Tín đồ|Tất cả|Tổ chức|Cơ sở|Nhân sự|Ban đại diện|Ban trị sự|Hồ sơ|Lịch sử|Phân loại";
  const tabButtonPattern = new RegExp(`await\\s+page\\.getByRole\\(['"]button['"],\\s*\\{\\s*name:\\s*(['"](?:${tabNamesList})['"]|/(?:${tabNamesList})/i)(?:,\\s*exact:\\s*(?:true|false))?\\s*\\}\\)\\.click\\(\\);?`, "g");
  if (tabButtonPattern.test(fixed)) {
    fixed = fixed.replace(tabButtonPattern, (_match, nameArg) => {
      const cleanName = nameArg.replace(/^['"]+|['"]+$/g, "");
      return `await page.getByRole('tab', { name: '${cleanName}' }).or(page.getByRole('button', { name: '${cleanName}' })).or(page.getByText('${cleanName}')).first().click();`;
    });
    fixes.push("FIX-19: Chuyển đổi getByRole('button') trên Tab sang Fallback Pattern an toàn (.or)");
  }

  // 19b. Dựa trên comment chứa chữ 'tab' phía trên lệnh click
  const commentTabButtonPattern = /(\/\/[^\n]*\btab\b[^\n]*\n\s*)await\s+page\.getByRole\(['"]button['"],\s*\{\s*name:\s*(['"][^'"]+['"])(?:,\s*exact:\s*(?:true|false))?\s*\}\)\.click\(\);?/gi;
  if (commentTabButtonPattern.test(fixed)) {
    fixed = fixed.replace(commentTabButtonPattern, (_match, comment, nameArg) => {
      const cleanName = nameArg.replace(/^['"]+|['"]+$/g, "");
      return `${comment}await page.getByRole('tab', { name: '${cleanName}' }).or(page.getByRole('button', { name: '${cleanName}' })).or(page.getByText('${cleanName}')).first().click();`;
    });
    fixes.push("FIX-19b: Tự động chuyển nút Tab theo comment bước kiểm thử sang Fallback Pattern (.or)");
  }

  // ── FIX 20: Chuyển đổi text assertion dài có exact:true sang partial match để tránh fail do dữ liệu động ──
  const longExactTextPattern = /page\.getByText\((['"][^'"]{12,}['"]),\s*\{\s*exact:\s*true\s*\}\)/g;
  if (longExactTextPattern.test(fixed)) {
    fixed = fixed.replace(longExactTextPattern, "page.getByText($1)");
    fixes.push("FIX-20: Loại bỏ { exact: true } cho chuỗi text dài để tránh lỗi không khớp dữ liệu động");
  }

  // ── FIX 21: Tự động gắn Fallback .or() và .first() cho toàn bộ các lệnh Click & Fill (Phòng ngừa lỗi trượt element) ──
  // 21a. Tự động thêm Fallback .or() cho mọi lệnh Click nếu chưa có .or()
  const standaloneClickPattern = /await\s+page\.(getByRole\(['"](?:button|tab|link)['"],\s*\{\s*name:\s*([^,}]+?)(?:,\s*exact:\s*(?:true|false))?\s*\}\)|getByText\(([^)]+?)\))(?!\.or\()\s*\.(?:first\(\)\.)?click\(([^)]*)\);?/g;
  if (standaloneClickPattern.test(fixed)) {
    fixed = fixed.replace(standaloneClickPattern, (_match, _fullLocator, roleName, textName, clickArgs) => {
      const name = (roleName || textName || "").trim();
      const extraArgs = clickArgs ? clickArgs : "";
      return `await page.getByRole('tab', { name: ${name} }).or(page.getByRole('button', { name: ${name} })).or(page.getByText(${name})).first().click(${extraArgs});`;
    });
    fixes.push("FIX-21: Tự động gắn Fallback .or() và .first() cho tất cả các thao tác Click");
  }

  // 21b. Tự động thêm Fallback .or() cho mọi lệnh Fill Input nếu chưa có .or()
  const standaloneFillPattern = /await\s+page\.(getByPlaceholder\(([^)]+?)\)|getByLabel\(([^)]+?)\))(?!\.or\()\s*\.(?:first\(\)\.)?fill\(([^)]+?)\);?/g;
  if (standaloneFillPattern.test(fixed)) {
    fixed = fixed.replace(standaloneFillPattern, (_match, _fullLocator, placeholderArg, labelArg, fillValue) => {
      const target = (placeholderArg || labelArg || "").trim();
      return `await page.getByPlaceholder(${target}).or(page.getByLabel(${target})).first().fill(${fillValue});`;
    });
    fixes.push("FIX-21b: Tự động gắn Fallback .or() và .first() cho tất cả các thao tác Fill Input");
  }

  // Log các fix đã áp dụng
  if (fixes.length > 0) {
    console.log(
      `\n🔧 [Post-Processing] Đã tự động sửa ${fixes.length} lỗi phổ biến:`,
    );
    fixes.forEach((f) => console.log(`   → ${f}`));
  }

  return fixed;
}
