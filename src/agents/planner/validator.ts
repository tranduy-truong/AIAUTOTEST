import type {
  ParsedAssertion,
  ParsedStep,
  PlannerClarification,
  PlannerStepType,
  StructuredE2EPlan,
} from './schema.js';

export interface PlannerValidationIssue {
  code: string;
  message: string;
  testCaseId?: string;
  stepIndex?: number;
  sourceLine?: string;
}

export interface PlannerValidationResult {
  valid: boolean;
  issues: PlannerValidationIssue[];
}

const STEP_TYPES = new Set<PlannerStepType>([
  'goto', 'fill', 'click', 'select', 'check', 'wait', 'noop',
]);
const ASSERTION_TYPES = new Set([
  'text_visible', 'url_contains', 'url_not_contains', 'attribute', 'unknown',
]);
const STEP_BULLET = /^[-*•·▪◦–—]\s*/u;

function normalizeLine(value: string): string {
  return value.replace(STEP_BULLET, '').replace(/\s+/g, ' ').trim();
}

function normalizeGroundingText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi')
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DESCRIPTOR_GLUE_WORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'co', 'cua', 'duoc', 'for', 'in', 'is', 'la',
  'mot', 'of', 'o', 'tai', 'the', 'tren', 'trong', 'under', 'with',
]);

const DESCRIPTOR_UI_WORDS = new Set([
  'bang', 'bieu', 'button', 'combobox', 'control', 'cot', 'dialog', 'dong',
  'drawer', 'dropdown', 'element', 'field', 'form', 'hang', 'icon', 'input',
  'link', 'list', 'menu', 'nut', 'option', 'popup', 'record', 'row', 'select',
  'table', 'textbox', 'tuong',
]);

const DESCRIPTOR_ALIASES = new Map<string, string>([
  ['edit', 'chinh'],
  ['pencil', 'but'],
  ['hang', 'dong'],
  ['row', 'dong'],
  ['record', 'dong'],
]);

function groundingTokens(value: string): string[] {
  return normalizeGroundingText(value)
    .split(' ')
    .filter(Boolean)
    .map(token => DESCRIPTOR_ALIASES.get(token) || token);
}

/**
 * target/context are semantic UI descriptions, not test data. The Planner may
 * safely remove connective words ("là", "tại") or use an equivalent structural
 * noun ("hàng"/"dòng"), but it may not invent a business identifier or action.
 */
function descriptorIsGrounded(description: string | undefined, sourceLine: string): boolean {
  if (!description?.trim()) return true;

  const normalizedDescription = normalizeGroundingText(description);
  const normalizedSource = normalizeGroundingText(sourceLine);
  if (normalizedSource.includes(normalizedDescription)) return true;

  const sourceTokens = new Set(groundingTokens(sourceLine));
  const descriptionTokens = groundingTokens(description);
  const significantTokens = descriptionTokens.filter(token =>
    !DESCRIPTOR_GLUE_WORDS.has(token) && !DESCRIPTOR_UI_WORDS.has(token),
  );

  // A generic UI descriptor such as "nút" is only safe when that same word is
  // present in the source. Otherwise there is no semantic anchor at all.
  if (significantTokens.length === 0) {
    return descriptionTokens.every(token => sourceTokens.has(token));
  }
  return significantTokens.every(token => sourceTokens.has(token));
}

/**
 * Re-anchor harmless formatting changes made by the LLM (single/double quotes,
 * punctuation, casing) to the exact source line. The whole normalized line
 * must still be identical and the match must be unique, so this cannot hide a
 * dropped word or attach an action to an ambiguous line.
 */
function matchSourceLine(candidate: string, sourceLines: string[]): string | undefined {
  const normalized = normalizeLine(candidate);
  const exact = sourceLines.find(line => line === normalized);
  if (exact) return exact;

  const key = normalizeGroundingText(normalized);
  if (!key) return undefined;
  const equivalent = sourceLines.filter(line => normalizeGroundingText(line) === key);
  return equivalent.length === 1 ? equivalent[0] : undefined;
}

interface SourceTestCase {
  name: string;
  lines: string[];
}

function sourceTestCases(script: string): Map<string, SourceTestCase> {
  const result = new Map<string, SourceTestCase>();
  let currentId: string | undefined;

  for (const original of script.split(/\r?\n/)) {
    const line = original.trim();
    if (!line) continue;
    const header = line.match(/^(TC(?:_[A-Z0-9]+)+)\s*[:-]\s*(.*)$/i);
    if (header) {
      currentId = header[1].toUpperCase();
      result.set(currentId, { name: header[2].trim(), lines: [] });
      continue;
    }
    if (currentId && STEP_BULLET.test(line)) {
      result.get(currentId)!.lines.push(normalizeLine(line));
    }
  }

  return result;
}

function hasForbiddenLocatorData(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/^(?:selector|locator|xpath|css)$/i.test(key)) return true;
    if (hasForbiddenLocatorData(nested)) return true;
  }
  return false;
}

function validateAssertion(assertion: ParsedAssertion): boolean {
  if (!assertion || !ASSERTION_TYPES.has(assertion.kind)) return false;
  if (typeof assertion.value !== 'string' || !assertion.value.trim()) return false;
  if (assertion.kind === 'attribute') {
    return assertion.target === 'password' &&
      assertion.name === 'type' &&
      (assertion.value === 'password' || assertion.value === 'text');
  }
  return true;
}

function requiredFields(step: ParsedStep): string[] {
  switch (step.type) {
    case 'goto': return step.url ? [] : ['url'];
    case 'fill': return [!step.target && 'target', step.value === undefined && 'value'].filter(Boolean) as string[];
    case 'click': return step.target ? [] : ['target'];
    case 'select': return [!step.target && 'target', step.value === undefined && 'value'].filter(Boolean) as string[];
    case 'check': return step.assertions?.length ? [] : ['assertions'];
    case 'wait':
    case 'noop':
      return [];
  }
}

function valuesAreGrounded(
  step: ParsedStep,
  sourceLine: string,
  fullSource: string,
): string[] {
  const missing: string[] = [];
  for (const [field, value] of [['value', step.value], ['url', step.url]] as const) {
    if (value && !fullSource.includes(value)) missing.push(field);
  }
  for (const assertion of step.assertions || []) {
    if (assertion.kind !== 'attribute' && !fullSource.includes(assertion.value)) {
      missing.push(`assertion:${assertion.value}`);
    }
  }
  for (const [field, description] of [['target', step.target], ['context', step.context]] as const) {
    if (!descriptorIsGrounded(description, sourceLine)) missing.push(field);
  }
  return missing;
}

export function validateStructuredE2EPlan(
  plan: StructuredE2EPlan,
  sourceScript: string,
): PlannerValidationResult {
  const issues: PlannerValidationIssue[] = [];
  const sourceCases = sourceTestCases(sourceScript);
  const fullSource = sourceScript.replace(/\r/g, '');

  if (plan.version !== 2 || plan.source !== 'ai-planner') {
    issues.push({ code: 'INVALID_PLAN_HEADER', message: 'Planner plan phải có version=2 và source=ai-planner.' });
  }
  if (!Array.isArray(plan.testCases) || plan.testCases.length === 0) {
    issues.push({ code: 'NO_TEST_CASES', message: 'Planner không trả về test case nào.' });
  }
  if (hasForbiddenLocatorData(plan)) {
    issues.push({ code: 'PLANNER_INVENTED_LOCATOR', message: 'Planner không được sinh selector/locator/xpath/css.' });
  }

  const seenIds = new Set<string>();
  for (const testCase of plan.testCases || []) {
    const id = String(testCase.id || '').toUpperCase();
    if (!id || seenIds.has(id)) {
      issues.push({ code: 'INVALID_OR_DUPLICATE_TC_ID', message: `Test case ID không hợp lệ hoặc bị trùng: ${testCase.id}` });
      continue;
    }
    seenIds.add(id);
    const sourceCase = sourceCases.get(id);
    if (!sourceCase) {
      issues.push({ code: 'UNGROUNDED_TEST_CASE', message: `${id} không tồn tại trong kịch bản gốc.`, testCaseId: id });
      continue;
    }
    if (testCase.name.trim() !== sourceCase.name) {
      issues.push({
        code: 'TEST_CASE_NAME_CHANGED',
        message: `Planner phải giữ nguyên tên test case: "${sourceCase.name}".`,
        testCaseId: id,
      });
    }
    const sourceLines = sourceCase.lines;

    const coveredLines = new Set<string>();
    for (const [index, step] of (testCase.steps || []).entries()) {
      const stepIndex = index + 1;
      if (!STEP_TYPES.has(step.type)) {
        issues.push({ code: 'INVALID_STEP_TYPE', message: `Loại bước không hợp lệ: ${step.type}`, testCaseId: id, stepIndex });
        continue;
      }
      const reportedSourceLine = normalizeLine(step.sourceLine || step.raw || '');
      const sourceLine = matchSourceLine(reportedSourceLine, sourceLines);
      if (!sourceLine) {
        issues.push({
          code: 'UNGROUNDED_STEP',
          message: 'Mỗi atomic step phải trỏ về một dòng nguyên văn trong kịch bản.',
          testCaseId: id,
          stepIndex,
          sourceLine: reportedSourceLine,
        });
      } else {
        // Persist the exact user-authored line in the canonical JSON plan.
        step.sourceLine = sourceLine;
        coveredLines.add(sourceLine);
      }

      const missing = requiredFields(step);
      if (missing.length > 0) {
        issues.push({
          code: 'MISSING_STEP_FIELDS',
          message: `Bước thiếu dữ liệu bắt buộc: ${missing.join(', ')}`,
          testCaseId: id,
          stepIndex,
          sourceLine: sourceLine || reportedSourceLine,
        });
      }
      if (step.type === 'check' && !(step.assertions || []).every(validateAssertion)) {
        issues.push({ code: 'INVALID_ASSERTION', message: 'Assertion không đúng schema.', testCaseId: id, stepIndex, sourceLine: sourceLine || reportedSourceLine });
      }
      if (step.type === 'check' && (step.assertions || []).some(assertion => assertion.kind === 'unknown')) {
        issues.push({
          code: 'NEEDS_CLARIFICATION',
          message: step.clarificationQuestion || 'Expected Result còn mơ hồ; cần tester xác nhận điều kiện quan sát được.',
          testCaseId: id,
          stepIndex,
          sourceLine: sourceLine || reportedSourceLine,
        });
      }
      const ungroundedValues = valuesAreGrounded(
        step,
        sourceLine || reportedSourceLine,
        fullSource,
      );
      if (ungroundedValues.length > 0) {
        issues.push({
          code: 'UNGROUNDED_VALUE',
          message: `Planner đã tạo dữ liệu không có trong kịch bản: ${ungroundedValues.join(', ')}`,
          testCaseId: id,
          stepIndex,
          sourceLine: sourceLine || reportedSourceLine,
        });
      }
      if (step.needsClarification || step.plannerConfidence === 'low') {
        issues.push({
          code: 'NEEDS_CLARIFICATION',
          message: step.clarificationQuestion || 'Bước còn mơ hồ và cần tester xác nhận.',
          testCaseId: id,
          stepIndex,
          sourceLine: sourceLine || reportedSourceLine,
        });
      }
    }

    for (const sourceLine of sourceLines) {
      if (!coveredLines.has(sourceLine)) {
        issues.push({ code: 'SOURCE_LINE_DROPPED', message: 'Planner đã bỏ sót dòng kịch bản.', testCaseId: id, sourceLine });
      }
    }
  }

  for (const sourceId of sourceCases.keys()) {
    if (!seenIds.has(sourceId)) {
      issues.push({ code: 'TEST_CASE_DROPPED', message: `Planner đã bỏ sót ${sourceId}.`, testCaseId: sourceId });
    }
  }
  for (const clarification of plan.clarifications || []) {
    issues.push({
      code: 'NEEDS_CLARIFICATION',
      message: clarification.question,
      testCaseId: clarification.testCaseId,
      sourceLine: normalizeLine(clarification.sourceLine),
    });
  }

  return { valid: issues.length === 0, issues };
}

export function clarificationsFromIssues(issues: PlannerValidationIssue[]): PlannerClarification[] {
  return issues
    .filter(issue => issue.code === 'NEEDS_CLARIFICATION' || issue.code === 'MISSING_STEP_FIELDS')
    .map(issue => ({
      testCaseId: issue.testCaseId || 'UNKNOWN',
      sourceLine: issue.sourceLine || '',
      question: issue.message,
      missingFields: [],
    }));
}
