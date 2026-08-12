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
  'undefined', 'nan', 'infinity', 'negative-infinity', 'bigint', 'date', 'regexp', 'map', 'set',
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
    if (value.$type === 'map') {
      if (!Array.isArray(value.entries)) return [`${label} cần entries dạng mảng cho $type=map.`];
      return value.entries.flatMap((entry, index) => {
        if (!Array.isArray(entry) || entry.length !== 2) {
          return [`${label}.entries[${index}] phải là cặp [key, value].`];
        }
        return [
          ...validateDataValue(entry[0], `${label}.entries[${index}][0]`),
          ...validateDataValue(entry[1], `${label}.entries[${index}][1]`),
        ];
      });
    }
    if (value.$type === 'set') {
      if (!Array.isArray(value.values)) return [`${label} cần values dạng mảng cho $type=set.`];
      return value.values.flatMap((item, index) => validateDataValue(item, `${label}.values[${index}]`));
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

/**
 * Re-anchor fields owned by Code Reader instead of asking the LLM to copy
 * hashes, project identity and execution policy perfectly. Test intent,
 * inputs, branches, mocks and expected results remain untouched and are still
 * validated strictly.
 */
export function anchorStructuredUnitPlan(
  plan: StructuredUnitPlan,
  context: UnitContextBundle,
): StructuredUnitPlan {
  const anchoredTargets = plan.targets.map((planTarget, index) => {
    const exact = context.targets.find(target =>
      target.sourceFile === planTarget.sourceFile && target.symbol === planTarget.symbol,
    );
    const target = exact || (context.targets.length === 1 && plan.targets.length === 1
      ? context.targets[0]
      : undefined);
    if (!target) return planTarget;
    return {
      ...planTarget,
      sourceFile: target.sourceFile,
      symbol: target.symbol,
      sourceHash: target.sourceHash,
      executionMode: target.executionMode,
      profile: target.profile,
      testCases: Array.isArray(planTarget.testCases) ? planTarget.testCases : [],
    };
  });
  return {
    ...plan,
    version: 1,
    source: 'ai-planner',
    project: {
      name: context.project.projectName,
      root: context.project.projectRoot,
      testFramework: context.project.testFramework,
    },
    targets: anchoredTargets,
    clarifications: Array.isArray(plan.clarifications) ? plan.clarifications : [],
  };
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
  if (planTarget.profile !== target.profile) {
    issues.push({ code: 'INVENTED_TESTABILITY_PROFILE', target: targetLabel, message: 'Planner đã thay đổi profile do Testability Classifier xác định.' });
  }
  if (target.supportingContext.truncated) {
    issues.push({
      code: 'SUPPORTING_CONTEXT_TRUNCATED', target: targetLabel,
      message: 'Call/type graph vượt ngân sách an toàn; hãy chọn target nhỏ hơn hoặc tách module trước khi sinh test.',
    });
  }
  if (!Array.isArray(planTarget.testCases) || planTarget.testCases.length === 0) {
    issues.push({ code: 'MISSING_TEST_CASES', target: targetLabel, message: 'Target không có test case.' });
    return issues;
  }

  const validBranches = new Set(target.branches.map(branch => branch.id));
  const validDependencies = new Set(target.dependencies.map(dependency => dependency.module));
  const requiredMocks = new Set(
    target.dependencies.filter(dependency => dependency.strategy === 'mock').map(dependency => dependency.module),
  );
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
      if (target.kind === 'function' || target.kind === 'class-method') {
        const declaredParameters = new Map(target.parameters.map(parameter => [parameter.name, parameter]));
        for (const parameter of target.parameters.filter(item => !item.optional)) {
          if (!(parameter.name in testCase.inputs)) {
            issues.push({
              code: 'MISSING_REQUIRED_INPUT', target: targetLabel, testCaseId: testCase.id,
              message: `Thiếu input bắt buộc: ${parameter.name}.`,
            });
          }
        }
        for (const [inputName, inputValue] of Object.entries(testCase.inputs)) {
          const parameter = declaredParameters.get(inputName);
          if (!parameter) {
            issues.push({
              code: 'INVENTED_INPUT', target: targetLabel, testCaseId: testCase.id,
              message: `Input không có trong chữ ký target: ${inputName}.`,
            });
            continue;
          }
          const type = parameter.type.replace(/\s+/g, ' ').trim();
          const mismatch =
            (/^(?:string)(?:\s*\|\s*(?:null|undefined))*$/i.test(type) && typeof inputValue !== 'string')
            || (/^(?:number)(?:\s*\|\s*(?:null|undefined))*$/i.test(type) && typeof inputValue !== 'number')
            || (/^(?:boolean)(?:\s*\|\s*(?:null|undefined))*$/i.test(type) && typeof inputValue !== 'boolean')
            || ((/\[\]|\bArray\s*</.test(type)) && !Array.isArray(inputValue))
            || ((/^\{|\b(?:Record|Map|Set)\s*</.test(type)) && !isObject(inputValue));
          if (mismatch) {
            issues.push({
              code: 'INPUT_TYPE_MISMATCH', target: targetLabel, testCaseId: testCase.id,
              message: `Input ${inputName} không khớp type ${parameter.type}.`,
            });
          }
        }
      }
    }
    if (target.kind === 'class-method') {
      const constructorInputs = testCase.constructorInputs ?? {};
      if (!isObject(constructorInputs)) {
        issues.push({
          code: 'INVALID_CONSTRUCTOR_INPUTS', target: targetLabel, testCaseId: testCase.id,
          message: 'constructorInputs phải là JSON object.',
        });
      } else {
        for (const message of validateDataValue(constructorInputs, 'constructorInputs')) {
          issues.push({ code: 'INVALID_CONSTRUCTOR_INPUTS', target: targetLabel, testCaseId: testCase.id, message });
        }
        const constructorParameters = new Map(
          (target.classMethod?.constructorParameters || []).map(parameter => [parameter.name, parameter]),
        );
        for (const parameter of (target.classMethod?.constructorParameters || []).filter(item => !item.optional)) {
          if (!(parameter.name in constructorInputs)) {
            issues.push({
              code: 'MISSING_REQUIRED_CONSTRUCTOR_INPUT', target: targetLabel, testCaseId: testCase.id,
              message: `Thiếu constructor input bắt buộc: ${parameter.name}.`,
            });
          }
        }
        for (const inputName of Object.keys(constructorInputs)) {
          if (!constructorParameters.has(inputName)) {
            issues.push({
              code: 'INVENTED_CONSTRUCTOR_INPUT', target: targetLabel, testCaseId: testCase.id,
              message: `Constructor input không tồn tại: ${inputName}.`,
            });
          }
        }
      }
    }
    if (!isObject(testCase.expected) || !['return', 'throw', 'resolve', 'reject', 'side-effect'].includes(String(testCase.expected.kind))) {
      issues.push({ code: 'INVALID_EXPECTED_RESULT', target: targetLabel, testCaseId: testCase.id, message: 'expected.kind không hợp lệ.' });
    } else if ('value' in testCase.expected) {
      for (const message of validateDataValue(testCase.expected.value, 'expected.value')) {
        issues.push({ code: 'INVALID_EXPECTED_RESULT', target: targetLabel, testCaseId: testCase.id, message });
      }
    }
    const expectedKind = testCase.expected?.kind;
    if (target.async && ['return', 'throw'].includes(String(expectedKind))) {
      issues.push({
        code: 'ASYNC_ORACLE_KIND_MISMATCH', target: targetLabel, testCaseId: testCase.id,
        message: 'Target async phải dùng expected.kind=resolve hoặc reject.',
      });
    }
    if (!target.async && ['resolve', 'reject'].includes(String(expectedKind))) {
      issues.push({
        code: 'SYNC_ORACLE_KIND_MISMATCH', target: targetLabel, testCaseId: testCase.id,
        message: 'Target đồng bộ không được dùng expected.kind=resolve/reject.',
      });
    }
    if (isObject(testCase.expected) && 'value' in testCase.expected) {
      const expectedValue = testCase.expected.value;
      if (/\bMap\s*</.test(target.returnType) && (!isObject(expectedValue) || expectedValue.$type !== 'map')) {
        issues.push({
          code: 'RETURN_TYPE_ORACLE_MISMATCH', target: targetLabel, testCaseId: testCase.id,
          message: 'Target trả về Map; expected.value phải dùng { "$type": "map", "entries": [...] }.',
        });
      }
      if (/\bSet\s*</.test(target.returnType) && (!isObject(expectedValue) || expectedValue.$type !== 'set')) {
        issues.push({
          code: 'RETURN_TYPE_ORACLE_MISMATCH', target: targetLabel, testCaseId: testCase.id,
          message: 'Target trả về Set; expected.value phải dùng { "$type": "set", "values": [...] }.',
        });
      }
    }
    const branchIds = Array.isArray(testCase.branchIds) ? testCase.branchIds : [];
    if (!Array.isArray(testCase.branchIds)) {
      issues.push({
        code: 'INVALID_BRANCH_REFERENCES',
        target: targetLabel,
        testCaseId: testCase.id,
        message: 'branchIds phải là mảng. Test bổ trợ không gắn với decision branch phải dùng mảng rỗng.',
      });
    }
    for (const branchId of branchIds) {
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
      if (validDependencies.has(mock.module) && !requiredMocks.has(mock.module)) {
        issues.push({
          code: 'MOCK_OF_REAL_DEPENDENCY', target: targetLabel, testCaseId: testCase.id,
          message: `Dependency ${mock.module} không có strategy=mock.`,
        });
      }
      if (typeof mock.behavior !== 'string' || !mock.behavior.trim()) {
        issues.push({ code: 'INVALID_MOCK_PLAN', target: targetLabel, testCaseId: testCase.id, message: 'Mock thiếu behavior rõ ràng.' });
      }
    }
    const plannedMocks = new Set((testCase.mocks || []).map(mock => mock.module));
    for (const dependency of requiredMocks) {
      if (!plannedMocks.has(dependency)) {
        issues.push({
          code: 'MISSING_REQUIRED_MOCK', target: targetLabel, testCaseId: testCase.id,
          message: `Test chưa cô lập dependency strategy=mock: ${dependency}.`,
        });
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
