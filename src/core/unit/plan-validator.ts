import type {
  StructuredUnitPlan,
  UnitContextBundle,
  UnitPlanTarget,
  UnitTarget,
} from './schema.js';

export interface UnitPlanValidationIssue {
  code: string;
  message: string;
  target?: string;
  testCaseId?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const SPECIAL_VALUE_TYPES = new Set([
  'undefined', 'nan', 'infinity', 'negative-infinity', 'bigint', 'date', 'regexp',
]);

function validateDataValue(value: unknown, label: string): string[] {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => validateDataValue(item, `${label}[${index}]`));
  if (!isObject(value)) return [`${label} không phải giá trị JSON hợp lệ.`];
  if ('$type' in value) {
    if (typeof value.$type !== 'string' || !SPECIAL_VALUE_TYPES.has(value.$type)) {
      return [`${label} có $type không được hỗ trợ.`];
    }
    if (['bigint', 'date', 'regexp'].includes(value.$type) && typeof value.value !== 'string') {
      return [`${label} cần trường value dạng string cho $type=${value.$type}.`];
    }
    return [];
  }
  return Object.entries(value).flatMap(([key, item]) => validateDataValue(item, `${label}.${key}`));
}

export function parseStructuredUnitPlan(raw: string): StructuredUnitPlan | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as StructuredUnitPlan;
    if (!isObject(parsed) || parsed.version !== 1 || parsed.source !== 'ai-planner' || !Array.isArray(parsed.targets)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function validateTarget(planTarget: UnitPlanTarget, target: UnitTarget): UnitPlanValidationIssue[] {
  const issues: UnitPlanValidationIssue[] = [];
  const targetLabel = `${target.sourceFile}#${target.symbol}`;
  if (planTarget.sourceHash !== target.sourceHash) {
    issues.push({ code: 'STALE_OR_INVENTED_SOURCE_HASH', target: targetLabel, message: 'sourceHash không khớp Code Reader.' });
  }
  if (planTarget.executionMode !== target.executionMode) {
    issues.push({ code: 'INVENTED_EXECUTION_MODE', target: targetLabel, message: 'Planner đã thay đổi executionMode do Target Classifier xác định.' });
  }
  if (!Array.isArray(planTarget.testCases) || planTarget.testCases.length === 0) {
    issues.push({ code: 'MISSING_TEST_CASES', target: targetLabel, message: 'Target không có test case.' });
    return issues;
  }

  const validBranches = new Set(target.branches.map(branch => branch.id));
  const validDependencies = new Set(target.dependencies.map(dependency => dependency.module));
  const coveredBranches = new Set<string>();
  const ids = new Set<string>();
  for (const testCase of planTarget.testCases) {
    if (!/^UT_[A-Z0-9_]+$/i.test(testCase.id || '')) {
      issues.push({ code: 'INVALID_TEST_ID', target: targetLabel, testCaseId: testCase.id, message: 'ID phải bắt đầu bằng UT_ và chỉ chứa chữ/số/dấu gạch dưới.' });
    }
    const normalizedId = String(testCase.id).toUpperCase();
    if (ids.has(normalizedId)) {
      issues.push({ code: 'DUPLICATE_TEST_ID', target: targetLabel, testCaseId: testCase.id, message: 'ID test case bị trùng.' });
    }
    ids.add(normalizedId);
    if (typeof testCase.name !== 'string' || !testCase.name.trim()) {
      issues.push({ code: 'MISSING_TEST_NAME', target: targetLabel, testCaseId: testCase.id, message: 'Test case thiếu tên.' });
    }
    if (!isObject(testCase.inputs)) {
      issues.push({ code: 'INVALID_TEST_INPUTS', target: targetLabel, testCaseId: testCase.id, message: 'inputs phải là JSON object.' });
    } else {
      for (const message of validateDataValue(testCase.inputs, 'inputs')) {
        issues.push({ code: 'INVALID_TEST_INPUTS', target: targetLabel, testCaseId: testCase.id, message });
      }
    }
    if (!isObject(testCase.expected) || !['return', 'throw', 'resolve', 'reject', 'side-effect'].includes(String(testCase.expected.kind))) {
      issues.push({ code: 'INVALID_EXPECTED_RESULT', target: targetLabel, testCaseId: testCase.id, message: 'expected.kind không hợp lệ.' });
    } else if ('value' in testCase.expected) {
      for (const message of validateDataValue(testCase.expected.value, 'expected.value')) {
        issues.push({ code: 'INVALID_EXPECTED_RESULT', target: targetLabel, testCaseId: testCase.id, message });
      }
    }
    if (!Array.isArray(testCase.branchIds) || testCase.branchIds.length === 0) {
      issues.push({ code: 'MISSING_BRANCH_REFERENCE', target: targetLabel, testCaseId: testCase.id, message: 'Test case chưa trỏ tới branch ID.' });
    }
    for (const branchId of testCase.branchIds || []) {
      if (!validBranches.has(branchId)) {
        issues.push({ code: 'INVENTED_BRANCH', target: targetLabel, testCaseId: testCase.id, message: `Branch không tồn tại: ${branchId}` });
      } else coveredBranches.add(branchId);
    }
    if (!['requirement', 'type-contract', 'existing-test', 'implementation'].includes(testCase.oracleSource)) {
      issues.push({ code: 'INVALID_ORACLE_SOURCE', target: targetLabel, testCaseId: testCase.id, message: 'oracleSource không hợp lệ.' });
    }
    if (!Array.isArray(testCase.mocks)) {
      issues.push({ code: 'INVALID_MOCK_PLAN', target: targetLabel, testCaseId: testCase.id, message: 'mocks phải là mảng.' });
    }
    for (const mock of testCase.mocks || []) {
      if (!validDependencies.has(mock.module)) {
        issues.push({ code: 'INVENTED_MOCK', target: targetLabel, testCaseId: testCase.id, message: `Dependency mock không có trong source: ${mock.module}` });
      }
      if (typeof mock.behavior !== 'string' || !mock.behavior.trim()) {
        issues.push({ code: 'INVALID_MOCK_PLAN', target: targetLabel, testCaseId: testCase.id, message: 'Mock thiếu behavior rõ ràng.' });
      }
    }
  }
  for (const branchId of validBranches) {
    if (!coveredBranches.has(branchId)) {
      issues.push({ code: 'UNCOVERED_BRANCH', target: targetLabel, message: `Planner chưa lập test cho branch ${branchId}.` });
    }
  }
  return issues;
}

export function validateStructuredUnitPlan(
  plan: StructuredUnitPlan,
  context: UnitContextBundle,
): UnitPlanValidationIssue[] {
  const issues: UnitPlanValidationIssue[] = [];
  if (plan.project?.root !== context.project.projectRoot || plan.project?.name !== context.project.projectName) {
    issues.push({ code: 'PROJECT_MISMATCH', message: 'Planner đã thay đổi project identity.' });
  }
  if (plan.project?.testFramework !== context.project.testFramework) {
    issues.push({ code: 'FRAMEWORK_MISMATCH', message: 'Planner đã thay đổi test framework được Scanner phát hiện.' });
  }
  const planTargets = new Map((plan.targets || []).map(target => [`${target.sourceFile}#${target.symbol}`, target]));
  for (const target of context.targets) {
    const key = `${target.sourceFile}#${target.symbol}`;
    const planTarget = planTargets.get(key);
    if (!planTarget) {
      issues.push({ code: 'MISSING_TARGET', target: key, message: 'Planner bỏ sót target được chọn.' });
      continue;
    }
    issues.push(...validateTarget(planTarget, target));
  }
  for (const key of planTargets.keys()) {
    if (!context.targets.some(target => `${target.sourceFile}#${target.symbol}` === key)) {
      issues.push({ code: 'INVENTED_TARGET', target: key, message: 'Planner tạo target không có trong Code Reader.' });
    }
  }
  return issues;
}

export function unitPlanForSingleTarget(
  plan: StructuredUnitPlan,
  target: UnitTarget,
): StructuredUnitPlan {
  return {
    ...plan,
    targets: plan.targets.filter(item => item.sourceFile === target.sourceFile && item.symbol === target.symbol),
  };
}
