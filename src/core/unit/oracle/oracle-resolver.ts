import type {
  UnitContextBundle,
  UnitExpectedResult,
  UnitOracleEvidence,
  UnitPlannedTestCase,
  UnitTarget,
} from '../schema.js';
import { validateExpectedIntent } from '../test-intent.schema.js';
import { dataValueToRuntime, evaluateTargetStatically, runtimeValuesEqual } from './ast-evaluator.js';

export type UnitOracleResolutionStatus = 'VERIFIED' | 'NEEDS_ORACLE';

export interface UnitOracleResolution {
  testCaseId: string;
  status: UnitOracleResolutionStatus;
  evidence?: UnitOracleEvidence;
  errors: string[];
}

function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi');
}

function expectedErrorMatches(
  expected: UnitExpectedResult,
  actual: { errorClass: string; message: string },
): boolean {
  if (expected.error?.className && expected.error.className !== actual.errorClass) return false;
  const matcher = expected.error?.message;
  if (matcher) {
    if (matcher.match === 'equals') return actual.message === matcher.value;
    if (matcher.match === 'contains') return actual.message.includes(matcher.value);
    try { return new RegExp(matcher.value, matcher.flags).test(actual.message); }
    catch { return false; }
  }
  if (expected.message !== undefined) return actual.message === expected.message;
  if (expected.value !== undefined) return runtimeValuesEqual(actual.message, dataValueToRuntime(expected.value));
  return true;
}

function verifyRequirement(
  testCase: UnitPlannedTestCase,
  requirements: string | undefined,
): UnitOracleResolution | undefined {
  if (testCase.oracleSource !== 'requirement' && testCase.oracleEvidence?.source !== 'requirement') return undefined;
  const reference = testCase.oracleEvidence?.reference?.trim();
  if (!reference) {
    return { testCaseId: testCase.id, status: 'NEEDS_ORACLE', errors: ['Oracle requirement thiếu exact reference.'] };
  }
  if (!requirements || !normalizeText(requirements).includes(normalizeText(reference))) {
    return {
      testCaseId: testCase.id,
      status: 'NEEDS_ORACLE',
      errors: ['Không tìm thấy oracle reference trong yêu cầu nghiệp vụ tester đã nhập.'],
    };
  }
  return {
    testCaseId: testCase.id,
    status: 'VERIFIED',
    evidence: { status: 'verified', source: 'requirement', reference },
    errors: [],
  };
}

function verifyImplementation(target: UnitTarget, testCase: UnitPlannedTestCase): UnitOracleResolution {
  const evaluated = evaluateTargetStatically(target, testCase.inputs);
  if (!evaluated.supported) {
    return {
      testCaseId: testCase.id,
      status: 'NEEDS_ORACLE',
      errors: [`Không thể chứng minh expected bằng static evaluator: ${evaluated.reason}`],
    };
  }
  const expectedKind = testCase.expected.kind;
  const expectsThrow = expectedKind === 'throw' || expectedKind === 'reject';
  if (evaluated.kind === 'throw') {
    if (!expectsThrow || !expectedErrorMatches(testCase.expected, evaluated)) {
      return {
        testCaseId: testCase.id,
        status: 'NEEDS_ORACLE',
        errors: ['Expected error không khớp kết quả được chứng minh từ implementation.'],
      };
    }
    return {
      testCaseId: testCase.id,
      status: 'VERIFIED',
      evidence: {
        status: 'verified', source: 'throw-literal', sourceFile: target.sourceFile,
        line: target.startLine, expression: evaluated.expression,
      },
      errors: [],
    };
  }
  if (expectsThrow || !['return', 'resolve'].includes(expectedKind)
    || !runtimeValuesEqual(evaluated.value, dataValueToRuntime(testCase.expected.value!))) {
    return {
      testCaseId: testCase.id,
      status: 'NEEDS_ORACLE',
      errors: ['Expected value không khớp kết quả được chứng minh từ implementation.'],
    };
  }
  return {
    testCaseId: testCase.id,
    status: 'VERIFIED',
    evidence: {
      status: 'verified', source: 'pure-evaluation', sourceFile: target.sourceFile,
      line: target.startLine, expression: evaluated.expression,
    },
    errors: [],
  };
}

export function resolveUnitTestOracle(
  context: Pick<UnitContextBundle, 'requirements'>,
  target: UnitTarget,
  testCase: UnitPlannedTestCase,
): UnitOracleResolution {
  const schemaIssues = validateExpectedIntent(testCase.expected);
  if (schemaIssues.length > 0) {
    return {
      testCaseId: testCase.id,
      status: 'NEEDS_ORACLE',
      errors: schemaIssues.map(issue => `${issue.path}: ${issue.message}`),
    };
  }
  const requirement = verifyRequirement(testCase, context.requirements);
  if (requirement) return requirement;
  if (testCase.oracleSource === 'implementation'
    || ['return-literal', 'throw-literal', 'pure-evaluation', 'ai-inference'].includes(testCase.oracleEvidence?.source || '')) {
    return verifyImplementation(target, testCase);
  }
  if (testCase.oracleEvidence?.source === 'sandbox-observation') {
    return {
      testCaseId: testCase.id,
      status: 'NEEDS_ORACLE',
      errors: ['Sandbox observation chỉ là characterization, chưa phải expected nghiệp vụ đã xác minh.'],
    };
  }
  return {
    testCaseId: testCase.id,
    status: 'NEEDS_ORACLE',
    errors: [`Nguồn ${testCase.oracleSource} chưa có resolver kiểm chứng bằng chứng cục bộ.`],
  };
}

export function resolveTargetOracles(
  context: Pick<UnitContextBundle, 'requirements'>,
  target: UnitTarget,
  testCases: UnitPlannedTestCase[],
): UnitOracleResolution[] {
  return testCases.map(testCase => resolveUnitTestOracle(context, target, testCase));
}
