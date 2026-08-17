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

function tryRepairTruncatedJson(str: string): Record<string, unknown> | null {
  const start = str.indexOf('{');
  if (start < 0) return null;
  const text = str.slice(start);

  // Tìm tất cả các dấu } đóng từ cuối lên để thử khôi phục test cases hoàn chỉnh
  const closingBraces: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '}') closingBraces.push(i);
  }

  for (let i = closingBraces.length - 1; i >= 0; i--) {
    const idx = closingBraces[i];
    const sub = text.slice(0, idx + 1);
    for (const suffix of ['\n]}\n}', '\n]}', '\n}', ']}', '}']) {
      try {
        const candidate = sub + suffix;
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.testCases) && parsed.testCases.length > 0) {
          return parsed as Record<string, unknown>;
        }
      } catch {}
    }
  }
  return null;
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
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {}
    }
    // Nếu JSON bị đứt cụt do giới hạn token, tự động sửa và cứu các test case hoàn chỉnh
    return tryRepairTruncatedJson(cleaned);
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

function parseAssertionString(raw: string): ParsedAssertion[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // url_not_contains hoặc không chứa url / không còn chứa
  if (/url_not_contains|không.*chứa.*url|url.*không.*chứa|không.*còn.*chứa/i.test(trimmed)) {
    const match = trimmed.match(/['"]([^'"]+)['"]/) || trimmed.match(/url_not_contains\s*[:=]?\s*(\S+)/i);
    const val = match ? match[1] : (trimmed.includes('dang-nhap') ? 'dang-nhap' : trimmed.replace(/^(?:check|kiểm tra)[:\s]*/i, ''));
    return [{ kind: 'url_not_contains', value: val.trim() }];
  }

  // url_contains hoặc url chứa
  if (/url_contains|url.*chứa/i.test(trimmed)) {
    const match = trimmed.match(/['"]([^'"]+)['"]/) || trimmed.match(/url_contains\s*[:=]?\s*(\S+)/i);
    const val = match ? match[1] : trimmed.replace(/^(?:check|kiểm tra)[:\s]*/i, '');
    return [{ kind: 'url_contains', value: val.trim() }];
  }

  // text_visible hoặc hiển thị text / thông báo
  const textMatch = trimmed.match(/['"]([^'"]+)['"]/);
  const textVal = textMatch ? textMatch[1] : trimmed.replace(/^(?:check|kiểm tra|text_visible)[:\s]*/i, '');
  return [{ kind: 'text_visible', value: textVal.trim() || trimmed }];
}

function normalizeAssertions(value: unknown): ParsedAssertion[] | undefined {
  if (typeof value === 'string' && value.trim()) {
    return parseAssertionString(value);
  }
  if (!Array.isArray(value)) return undefined;
  return value
    .filter(assertion => assertion && (typeof assertion === 'object' || typeof assertion === 'string'))
    .map(rawItem => {
      if (typeof rawItem === 'string') {
        const parsed = parseAssertionString(rawItem);
        return parsed[0] || { kind: 'text_visible', value: rawItem };
      }
      const item = rawItem as Record<string, unknown>;
      const kind = String(item.kind || '');
      const name = String(item.name || '');
      const valStr = String(item.value || '').toLowerCase();

      if (kind === 'attribute' || name.toLowerCase() === 'type') {
        let normalizedVal: 'password' | 'text' = 'text';
        if (/password|an|ẩn|cham|chấm|mat khau|mật khẩu/.test(valStr)) {
          normalizedVal = 'password';
        } else if (/text|van ban|văn bản|doc duoc|đọc được|ro|rõ|hien|hiển/.test(valStr)) {
          normalizedVal = 'text';
        }
        return {
          kind: 'attribute',
          target: 'password',
          name: 'type',
          value: normalizedVal,
        } as ParsedAssertion;
      }
      // Nếu kind không có hoặc là chuỗi generic, suy đoán từ value/kind
      if (!kind || !['text_visible', 'url_contains', 'url_not_contains', 'attribute', 'unknown'].includes(kind)) {
        if (/not_contain|không.*chứa/i.test(kind || valStr)) {
          return { kind: 'url_not_contains', value: String(item.value || valStr) } as ParsedAssertion;
        }
        if (/contains|chứa/i.test(kind || valStr)) {
          return { kind: 'url_contains', value: String(item.value || valStr) } as ParsedAssertion;
        }
        return { kind: 'text_visible', value: String(item.value || valStr) } as ParsedAssertion;
      }
      return item as unknown as ParsedAssertion;
    });
}

function normalizeStep(value: unknown, index: number): ParsedStep | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const sourceLine = String(input.sourceLine || input.raw || '').trim();
  const stepType = String(input.type || '').trim().toLowerCase() as ParsedStep['type'];

  let assertions = normalizeAssertions(input.assertions);
  if ((!assertions || assertions.length === 0) && stepType === 'check') {
    const textToParse = typeof input.assertion === 'string' && input.assertion.trim()
      ? input.assertion.trim()
      : typeof input.value === 'string' && input.value.trim()
      ? input.value.trim()
      : typeof input.target === 'string' && input.target.trim()
      ? input.target.trim()
      : typeof input.raw === 'string' && input.raw.trim()
      ? input.raw.trim()
      : '';
    if (textToParse) {
      assertions = parseAssertionString(textToParse);
    }
  }

  return {
    type: stepType,
    target: typeof input.target === 'string' ? input.target.trim() : undefined,
    value: typeof input.value === 'string' ? input.value : undefined,
    url: typeof input.url === 'string' ? input.url.trim() : undefined,
    context: typeof input.context === 'string' ? input.context.trim() : undefined,
    assertion: typeof input.assertion === 'string' ? input.assertion.trim() : undefined,
    assertions,
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

function isLoginStep(step: ParsedStep): boolean {
  if (step.type === 'goto' && /(?:dang-nhap|login|signin|sign-in)/i.test(step.url || '')) return true;
  if (step.type === 'fill') {
    const targetNorm = (step.target || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/(?:ten dang nhap|username|tai khoan|mat khau|password)/i.test(targetNorm)) return true;
  }
  if (step.type === 'click') {
    const targetNorm = (step.target || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/(?:dang nhap|login|sign in|signin)/i.test(targetNorm)) return true;
  }
  if (step.type === 'check') {
    const rawNorm = (step.raw || '').toLowerCase();
    if (rawNorm.includes('dang-nhap') || rawNorm.includes('login')) return true;
    if (step.assertions?.some(a => a.kind === 'url_not_contains' && /dang-nhap|login/i.test(a.value || ''))) return true;
  }
  return false;
}

/** Đảm bảo không bao giờ đăng nhập 2 lần trong cùng một testcase. Chỉ giữ cụm đăng nhập đầu tiên. */
function deduplicateLoginSteps(steps: ParsedStep[]): ParsedStep[] {
  let hasLoggedIn = false;
  const result: ParsedStep[] = [];
  let inSubsequentLoginBlock = false;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Phát hiện bắt đầu một cụm login mới
    if (step.type === 'goto' && /(?:dang-nhap|login|signin|sign-in)/i.test(step.url || '')) {
      if (!hasLoggedIn) {
        hasLoggedIn = true;
        inSubsequentLoginBlock = false;
        result.push(step);
      } else {
        // Đã đăng nhập trước đó rồi -> Bỏ qua lần đăng nhập lặp lại này
        inSubsequentLoginBlock = true;
      }
      continue;
    }

    if (inSubsequentLoginBlock) {
      if (isLoginStep(step)) {
        // Bỏ qua các bước fill/click/check trong cụm login trùng lặp
        continue;
      } else {
        // Hết cụm login trùng lặp -> quay lại ghi nhận bước bình thường
        inSubsequentLoginBlock = false;
      }
    }

    result.push(step);
  }

  return result;
}

function normalizeTestCase(value: unknown): PlannerTestCase | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const rawSteps = Array.isArray(input.steps)
    ? input.steps.map(normalizeStep).filter((step): step is ParsedStep => Boolean(step))
    : [];
  const steps = deduplicateLoginSteps(rawSteps);
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
