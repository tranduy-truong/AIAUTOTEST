import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAIAdapter } from '../../adapters/openai.js';
import { renderStructuredPlanMarkdown } from './markdown-renderer.js';
import { normalizePlannerOutput } from './normalizer.js';
import type { StructuredE2EPlan } from './schema.js';
import {
  validateStructuredE2EPlan,
  type PlannerValidationIssue,
} from './validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E2E_JSON_PATH = 'artifacts/test-plan-e2e.json';
const E2E_MARKDOWN_PATH = 'artifacts/test-plan-e2e.md';
const E2E_INVALID_PATH = 'artifacts/test-plan-e2e.invalid.txt';
const E2E_ERRORS_PATH = 'artifacts/planner-validation-errors.json';
const MAX_E2E_CHUNK_CHARS = 4500;

function parseJsonArray(rawOutput: string): unknown[] | null {
  const withoutFence = rawOutput
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(withoutFence);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function ensureArtifactsDir(): void {
  fs.mkdirSync('artifacts', { recursive: true });
}

function validationIssuesForRawOutput(
  rawOutput: string,
  sourceScript: string,
): { plan: StructuredE2EPlan | null; issues: PlannerValidationIssue[] } {
  const plan = normalizePlannerOutput(rawOutput);
  if (!plan) {
    return {
      plan: null,
      issues: [{
        code: 'INVALID_JSON',
        message: 'Planner không trả về một JSON object hợp lệ.',
      }],
    };
  }
  return { plan, issues: validateStructuredE2EPlan(plan, sourceScript).issues };
}

export function loadStructuredE2EPlan(
  filePath = E2E_JSON_PATH,
): StructuredE2EPlan {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StructuredE2EPlan;
  if (parsed.version !== 2 || parsed.source !== 'ai-planner' || !Array.isArray(parsed.testCases)) {
    throw new Error(`Structured Planner Plan không hợp lệ: ${filePath}`);
  }
  return parsed;
}

function createTask(systemPrompt: string, sourceScript: string): string {
  return `${systemPrompt}\n\n---\n\n[KỊCH BẢN THỰC TẾ CỦA NGƯỜI DÙNG]\n${sourceScript.trim()}\n\n[HẾT KỊCH BẢN]\n\nChỉ xuất JSON object đúng schema.`;
}

function createRepairTask(
  task: string,
  rawOutput: string,
  issues: PlannerValidationIssue[],
): string {
  const compactIssues = issues.slice(0, 30).map(issue => ({
    code: issue.code,
    testCaseId: issue.testCaseId,
    stepIndex: issue.stepIndex,
    sourceLine: issue.sourceLine,
    message: issue.message,
  }));
  return `${task}\n\n[OUTPUT TRƯỚC KHÔNG ĐẠT HỢP ĐỒNG]\n${rawOutput}\n\n[LỖI CẦN SỬA]\n${JSON.stringify(compactIssues)}\n\nSửa toàn bộ lỗi và chỉ trả về JSON object hoàn chỉnh.`;
}

export function splitE2EScript(
  sourceScript: string,
  maxChars = MAX_E2E_CHUNK_CHARS,
): string[] {
  const lines = sourceScript.replace(/\r/g, '').split('\n');
  const preamble: string[] = [];
  const blocks: string[][] = [];
  let current: string[] | undefined;

  for (const line of lines) {
    if (/^\s*TC(?:_[A-Z0-9]+)+\s*[:-]/i.test(line)) {
      current = [line];
      blocks.push(current);
    } else if (current) {
      current.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (blocks.length === 0) return [sourceScript.trim()];

  const units: string[] = [];
  for (const block of blocks) {
    const header = block[0];
    let unit = header;
    for (const line of block.slice(1)) {
      if (`${preamble.join('\n')}\n${unit}\n${line}`.length > maxChars && unit !== header) {
        units.push(unit);
        unit = `${header}\n${line}`;
      } else {
        unit += `\n${line}`;
      }
    }
    units.push(unit);
  }

  const chunks: string[] = [];
  let chunk = preamble.join('\n').trim();
  for (const unit of units) {
    const candidate = [chunk, unit].filter(Boolean).join('\n');
    if (candidate.length > maxChars && chunk && chunk !== preamble.join('\n').trim()) {
      chunks.push(chunk.trim());
      chunk = [preamble.join('\n').trim(), unit].filter(Boolean).join('\n');
    } else {
      chunk = candidate;
    }
  }
  if (chunk.trim()) chunks.push(chunk.trim());
  return chunks;
}

function mergeStructuredPlans(plans: StructuredE2EPlan[]): StructuredE2EPlan {
  const testCases = new Map<string, StructuredE2EPlan['testCases'][number]>();
  for (const plan of plans) {
    for (const testCase of plan.testCases) {
      const id = testCase.id.toUpperCase();
      const existing = testCases.get(id);
      if (!existing) {
        testCases.set(id, { ...testCase, steps: [...testCase.steps] });
      } else {
        existing.steps.push(...testCase.steps);
        existing.preconditions = [...new Set([...(existing.preconditions || []), ...(testCase.preconditions || [])])];
        existing.expectedResults = [...new Set([...(existing.expectedResults || []), ...(testCase.expectedResults || [])])];
        existing.notes = [...new Set([...(existing.notes || []), ...(testCase.notes || [])])];
      }
    }
  }
  return {
    version: 2,
    source: 'ai-planner',
    testCases: [...testCases.values()],
    clarifications: plans.flatMap(plan => plan.clarifications),
  };
}

async function callPlannerAdapter(taskContent: string, suffix = '') {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const runId = `run_${Date.now()}${suffix}_${attempt}`;
    const workDir = path.join(process.cwd(), '.testkit', 'runs', runId);
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'task.md'), taskContent.trim());

    const adapter = new OpenAIAdapter('llama-3.3-70b-versatile');
    const result = await adapter.run({
      promptDir: workDir,
      workDir,
      timeoutMs: 120000,
      maxTokens: 3500,
    });
    if (result.ok || !/rate.limit|tokens per minute|tpm/i.test(result.rawOutput) || attempt === 4) {
      return result;
    }

    const waitMs = attempt * 12000;
    console.warn(`   Groq dang gioi han TPM; tu dong cho ${waitMs / 1000}s roi thu lai (${attempt}/4)...`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  return { ok: false, rawOutput: 'Planner retry loop ended unexpectedly.' };
}

async function planOneChunk(
  systemPrompt: string,
  sourceChunk: string,
  chunkIndex: number,
): Promise<{ plan: StructuredE2EPlan | null; issues: PlannerValidationIssue[]; rawOutput: string }> {
  const task = createTask(systemPrompt, sourceChunk);
  let result = await callPlannerAdapter(task, `_chunk_${chunkIndex}`);
  if (!result.ok) {
    return {
      plan: null,
      issues: [{ code: 'AI_API_ERROR', message: result.rawOutput }],
      rawOutput: result.rawOutput,
    };
  }

  let validation = validationIssuesForRawOutput(result.rawOutput, sourceChunk);
  if (!validation.plan || validation.issues.length > 0) {
    console.warn(`   Lo ${chunkIndex}: output chua dat hop dong (${validation.issues.length} loi), dang tu sua mot lan...`);
    const repair = await callPlannerAdapter(
      createRepairTask(task, result.rawOutput, validation.issues),
      `_chunk_${chunkIndex}_repair`,
    );
    if (repair.ok) {
      result = repair;
      validation = validationIssuesForRawOutput(result.rawOutput, sourceChunk);
    }
  }
  return { ...validation, rawOutput: result.rawOutput };
}

async function runStructuredE2EPlanner(
  systemPrompt: string,
  sourceScript: string,
): Promise<boolean> {
  ensureArtifactsDir();
  for (const stalePath of [
    E2E_JSON_PATH,
    E2E_MARKDOWN_PATH,
    'artifacts/action-plan.json',
    'artifacts/crawled-dom.md',
    'artifacts/unresolved-actions.json',
  ]) {
    fs.rmSync(stalePath, { force: true });
  }
  const chunks = splitE2EScript(sourceScript);
  if (chunks.length > 1) {
    console.log(`   Kịch bản lớn được chia thành ${chunks.length} lô theo test case để không vượt giới hạn TPM.`);
  }

  const chunkPlans: StructuredE2EPlan[] = [];
  const allIssues: PlannerValidationIssue[] = [];
  const rawOutputs: string[] = [];
  for (const [index, chunk] of chunks.entries()) {
    if (chunks.length > 1) console.log(`   Planner đang phân tích lô ${index + 1}/${chunks.length}...`);
    const chunkResult = await planOneChunk(systemPrompt, chunk, index + 1);
    rawOutputs.push(chunkResult.rawOutput);
    if (chunkResult.plan && chunkResult.issues.length === 0) chunkPlans.push(chunkResult.plan);
    allIssues.push(...chunkResult.issues);
  }

  const mergedPlan = chunkPlans.length === chunks.length
    ? mergeStructuredPlans(chunkPlans)
    : null;
  const finalIssues = mergedPlan
    ? validateStructuredE2EPlan(mergedPlan, sourceScript).issues
    : allIssues;

  if (!mergedPlan || finalIssues.length > 0) {
    fs.writeFileSync(E2E_INVALID_PATH, rawOutputs.join('\n\n--- CHUNK ---\n\n').trim() + '\n');
    fs.writeFileSync(E2E_ERRORS_PATH, JSON.stringify(finalIssues, null, 2) + '\n');
    console.error(`❌ Planner chưa hiểu chắc chắn ${finalIssues.length} điểm; không chuyển sang Crawler.`);
    for (const issue of finalIssues.slice(0, 10)) {
      const where = [issue.testCaseId, issue.stepIndex && `bước ${issue.stepIndex}`]
        .filter(Boolean)
        .join(' - ');
      console.error(`   - ${where ? `${where}: ` : ''}${issue.message}`);
    }
    console.error(`   Chi tiết: ${E2E_ERRORS_PATH}`);
    return false;
  }

  fs.writeFileSync(E2E_JSON_PATH, JSON.stringify(mergedPlan, null, 2) + '\n');
  fs.writeFileSync(E2E_MARKDOWN_PATH, renderStructuredPlanMarkdown(mergedPlan));
  fs.rmSync(E2E_INVALID_PATH, { force: true });
  fs.rmSync(E2E_ERRORS_PATH, { force: true });
  console.log(`✅ Đã lập xong kế hoạch có cấu trúc! Lưu tại: ${E2E_JSON_PATH}`);
  console.log(`   Bản đọc cho tester: ${E2E_MARKDOWN_PATH}`);
  return true;
}

export async function runPlanner(
  level: 'unit' | 'integration' | 'e2e',
  contextData: string,
): Promise<boolean> {
  console.log(`\n🧠 [Planner Agent] Đang phân tích yêu cầu cho tầng: ${level.toUpperCase()}`);

  const promptFilePath = path.join(__dirname, `prompt-${level}.md`);
  if (!fs.existsSync(promptFilePath)) {
    console.error(`❌ Không tìm thấy file prompt: ${promptFilePath}`);
    return false;
  }
  const systemPrompt = fs.readFileSync(promptFilePath, 'utf-8');

  if (level === 'e2e') {
    return runStructuredE2EPlanner(systemPrompt, contextData);
  }

  const taskContent = `${systemPrompt}\n\n[THÔNG TIN THỰC TẾ]\n${contextData}\n\nChỉ xuất mảng JSON đúng schema.`;
  const result = await callPlannerAdapter(taskContent);
  if (!result.ok) {
    console.error('❌ Lỗi khi Planner chạy:', result.rawOutput);
    return false;
  }

  ensureArtifactsDir();
  const parsedPlan = parseJsonArray(result.rawOutput);
  if (!parsedPlan) {
    const invalidPath = `artifacts/test-plan-${level}.invalid.txt`;
    fs.writeFileSync(invalidPath, result.rawOutput.trim() + '\n');
    console.error(`❌ Planner không trả về JSON hợp lệ. Đã lưu tại ${invalidPath}`);
    return false;
  }

  const planPath = `artifacts/test-plan-${level}.json`;
  fs.writeFileSync(planPath, JSON.stringify(parsedPlan, null, 2) + '\n');
  console.log(`✅ Đã lập xong kế hoạch! Lưu tại: ${planPath}`);
  return true;
}
