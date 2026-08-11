import type {
  ParsedAssertion,
  ParsedStep,
  PlannerClarification,
  PlannerTestCase,
  StructuredE2EPlan,
} from './schema.js';

function stripCodeFence(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function parseJsonObject(rawOutput: string): Record<string, unknown> | null {
  const cleaned = stripCodeFence(rawOutput);
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
}

function hasForbiddenLocatorData(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/^(?:selector|locator|xpath|css)$/i.test(key)) return true;
    if (hasForbiddenLocatorData(nested)) return true;
  }
  return false;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

function normalizeAssertions(value: unknown): ParsedAssertion[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter(assertion => assertion && typeof assertion === 'object')
    .map(assertion => assertion as ParsedAssertion);
}

function normalizeStep(value: unknown, index: number): ParsedStep | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const sourceLine = String(input.sourceLine || input.raw || '').trim();
  return {
    type: String(input.type || '') as ParsedStep['type'],
    target: typeof input.target === 'string' ? input.target.trim() : undefined,
    value: typeof input.value === 'string' ? input.value : undefined,
    url: typeof input.url === 'string' ? input.url.trim() : undefined,
    context: typeof input.context === 'string' ? input.context.trim() : undefined,
    assertion: typeof input.assertion === 'string' ? input.assertion.trim() : undefined,
    assertions: normalizeAssertions(input.assertions),
    raw: typeof input.raw === 'string' && input.raw.trim() ? input.raw.trim() : sourceLine,
    sourceLine,
    plannerConfidence: ['high', 'medium', 'low'].includes(String(input.confidence))
      ? String(input.confidence) as ParsedStep['plannerConfidence']
      : 'medium',
    needsClarification: input.needsClarification === true,
    clarificationQuestion: typeof input.clarificationQuestion === 'string'
      ? input.clarificationQuestion.trim()
      : undefined,
  };
}

function normalizeTestCase(value: unknown): PlannerTestCase | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const steps = Array.isArray(input.steps)
    ? input.steps.map(normalizeStep).filter((step): step is ParsedStep => Boolean(step))
    : [];
  return {
    id: String(input.id || '').trim(),
    name: String(input.name || '').trim(),
    module: typeof input.module === 'string' ? input.module.trim() : undefined,
    objective: typeof input.objective === 'string' ? input.objective.trim() : undefined,
    preconditions: stringArray(input.preconditions),
    expectedResults: stringArray(input.expectedResults),
    priority: ['Critical', 'High', 'Medium', 'Low'].includes(String(input.priority))
      ? input.priority as PlannerTestCase['priority']
      : undefined,
    testType: stringArray(input.testType),
    automationSuitability: ['Yes', 'No', 'Partial'].includes(String(input.automationSuitability))
      ? input.automationSuitability as PlannerTestCase['automationSuitability']
      : undefined,
    notes: stringArray(input.notes),
    url: typeof input.url === 'string' ? input.url.trim() : steps.find(step => step.type === 'goto')?.url,
    steps,
    unparsedSteps: [],
  };
}

function normalizeClarification(value: unknown): PlannerClarification | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  return {
    testCaseId: String(input.testCaseId || 'UNKNOWN'),
    sourceLine: String(input.sourceLine || ''),
    question: String(input.question || 'Cần tester xác nhận thêm thông tin.'),
    missingFields: stringArray(input.missingFields),
  };
}

export function normalizePlannerOutput(rawOutput: string): StructuredE2EPlan | null {
  const parsed = parseJsonObject(rawOutput);
  if (!parsed || hasForbiddenLocatorData(parsed)) return null;
  const testCases = Array.isArray(parsed.testCases)
    ? parsed.testCases.map(normalizeTestCase).filter((item): item is PlannerTestCase => Boolean(item))
    : [];
  const clarifications = Array.isArray(parsed.clarifications)
    ? parsed.clarifications.map(normalizeClarification).filter((item): item is PlannerClarification => Boolean(item))
    : [];
  return {
    version: Number(parsed.version) as StructuredE2EPlan['version'],
    source: String(parsed.source || '') as StructuredE2EPlan['source'],
    testCases,
    clarifications,
  };
}
