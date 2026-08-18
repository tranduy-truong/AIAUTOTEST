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

  // Trích xuất hoặc tự động suy luận ariaRole chuẩn xác
  let ariaRole = typeof input.ariaRole === 'string' && input.ariaRole.trim()
    ? input.ariaRole.trim()
    : typeof input.role === 'string' && input.role.trim()
    ? input.role.trim()
    : undefined;

  if (!ariaRole) {
    if (stepType === 'fill') {
      ariaRole = 'textbox';
    } else if (stepType === 'select') {
      ariaRole = 'combobox';
    } else if (stepType === 'click') {
      if (typeof input.context === 'string' && input.context.toLowerCase().includes('sidebar')) {
        ariaRole = 'sidebar';
      } else if (sourceLine.toLowerCase().includes('discovery: button') || /bấm nút|click button/i.test(sourceLine) || /tìm kiếm|thêm|lưu|đăng nhập/i.test(String(input.target || ''))) {
        ariaRole = 'button';
      } else if (sourceLine.toLowerCase().includes('tab') || /chuyển.*tab|tab/i.test(sourceLine) || /thông tin chung|quá trình thay đổi|chức việc|chức sắc|nhà tu hành|tín đồ/i.test(String(input.target || ''))) {
        ariaRole = 'tab';
      } else if (sourceLine.toLowerCase().includes('discovery: a') || /link|liên kết/i.test(sourceLine)) {
        ariaRole = 'link';
      } else {
        ariaRole = 'button';
      }
    }
  }

  return {
    type: stepType,
    target: typeof input.target === 'string' ? input.target.trim() : undefined,
    ariaRole,
    value: typeof input.value === 'string' ? input.value : undefined,
    url: typeof input.url === 'string' ? input.url.trim() : undefined,
    context: typeof input.context === 'string' ? input.context.trim() : undefined,
    assertion: typeof input.assertion === 'string' ? input.assertion.trim() : undefined,
    assertions,
    raw: typeof input.raw === 'string' && input.raw.trim() ? input.raw.trim() : sourceLine,
    sourceLine,
    plannerConfidence: ['high', 'medium', 'low'].includes(String(input.confidence || input.plannerConfidence))
      ? String(input.confidence || input.plannerConfidence) as ParsedStep['plannerConfidence']
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

function inferModuleAcronym(text: string): string {
  const norm = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/dang nhap|login|auth|xac thuc|tai khoan/.test(norm)) return 'AUTH';
  if (/gio hang|cart|checkout|thanh toan|order/.test(norm)) return 'CART';
  if (/san pham|product|item|hang hoa/.test(norm)) return 'PROD';
  if (/to chuc|organization|org/.test(norm)) return 'ORG';
  if (/co so|facility|branch/.test(norm)) return 'FACILITY';
  if (/nhan su|nhan vien|user|employee/.test(norm)) return 'STAFF';
  if (/tim kiem|search|filter|loc/.test(norm)) return 'SEARCH';
  if (/phan trang|pagination|page/.test(norm)) return 'PAG';
  if (/menu|sidebar|navigation|dieu huong/.test(norm)) return 'NAV';
  return 'CORE';
}

function inferCategoryAcronym(text: string): string {
  const norm = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/sqli|xss|injection|bao mat|security/.test(norm)) return 'SEC';
  if (/validation|bat buoc|form rong|blank|de trong|invalid/.test(norm)) return 'VAL';
  if (/sieu dai|500|boundary|cuc han|vung bien|overflow/.test(norm)) return 'BOUND';
  if (/empty|khong ton tai|khong co du lieu|rong/.test(norm)) return 'EMPTY';
  if (/sap xep|sort|tang dan|giam dan|low to high|a to z/.test(norm)) return 'SORT';
  if (/phan trang|pagination|so dong|trang truoc|trang sau/.test(norm)) return 'PAG';
  if (/sidebar|toggle|responsive|modal|drawer|dong mo|giao dien/.test(norm)) return 'UI';
  return 'HP';
}

function normalizeTestCase(value: unknown, testIndex: number): PlannerTestCase | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const rawSteps = Array.isArray(input.steps)
    ? input.steps.map(normalizeStep).filter((step): step is ParsedStep => Boolean(step))
    : [];
  const steps = deduplicateLoginSteps(rawSteps);

  const rawId = String(input.id || '').trim();
  const rawName = String(input.name || '').trim();
  const rawModule = typeof input.module === 'string' ? input.module.trim() : undefined;
  const contextStr = `${rawId} ${rawName} ${rawModule || ''} ${steps.map(s => s.raw).join(' ')}`;

  // 1. Chuẩn hóa ID theo chuẩn QA: TC_[MODULE]_[CATEGORY]_[NN]
  let id = rawId;
  const standardIdPattern = /^TC_[A-Z0-9]+_[A-Z0-9]+_\d+$/i;
  if (!standardIdPattern.test(id)) {
    const mod = inferModuleAcronym(rawModule || contextStr);
    const cat = inferCategoryAcronym(contextStr);
    const num = String(testIndex + 1).padStart(2, '0');
    id = `TC_${mod}_${cat}_${num}`;
  } else {
    id = id.toUpperCase();
  }

  // 2. Chuẩn hóa Tên test case (Test Case Title) theo chuẩn QA: [TC_ID] - [Hành động] - [Kết quả mong đợi]
  let name = rawName;
  if (!name) {
    name = `${id} - Kiểm thử chức năng nghiệp vụ hợp lệ`;
  } else {
    // Xóa các tiền tố ID cũ lộn xộn nếu có
    name = name.replace(/^TC[_\-\s0-9A-Za-z]+[-:]\s*/i, '').trim();
    name = `${id} - ${name}`;
  }

  // 3. Chuẩn hóa Objective (Mục tiêu kiểm thử)
  let objective = typeof input.objective === 'string' && input.objective.trim()
    ? input.objective.trim()
    : undefined;
  if (!objective) {
    objective = `Xác minh tính đúng đắn và sự toàn vẹn của hệ thống trong kịch bản ${name}`;
  }

  // 4. Chuẩn hóa Preconditions & Expected Results
  let preconditions = stringArray(input.preconditions);
  if (preconditions.length === 0) {
    preconditions = ['Người dùng có quyền truy cập hợp lệ vào hệ thống'];
  }

  let expectedResults = stringArray(input.expectedResults);
  if (expectedResults.length === 0) {
    const checkSteps = steps.filter(s => s.type === 'check');
    if (checkSteps.length > 0) {
      expectedResults = checkSteps.map(s => s.raw || 'Dữ liệu và giao diện hiển thị chính xác theo yêu cầu');
    } else {
      expectedResults = ['Hệ thống thực thi các thao tác thành công và không phát sinh lỗi'];
    }
  }

  return {
    id,
    name,
    module: rawModule || `Phân hệ ${inferModuleAcronym(contextStr)}`,
    objective,
    preconditions,
    expectedResults,
    priority: ['Critical', 'High', 'Medium', 'Low'].includes(String(input.priority))
      ? input.priority as PlannerTestCase['priority']
      : 'High',
    testType: stringArray(input.testType).length > 0 ? stringArray(input.testType) : ['Functional', 'E2E'],
    automationSuitability: ['Yes', 'No', 'Partial'].includes(String(input.automationSuitability))
      ? input.automationSuitability as PlannerTestCase['automationSuitability']
      : 'Yes',
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
