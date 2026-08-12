import type {
  UnitContextBundle,
  UnitExpectedResult,
  UnitOracleEvidence,
  UnitPlannedTestCase,
  UnitTarget,
} from '../schema.js';
import { validateExpectedIntent } from '../test-intent.schema.js';
import { dataValueToRuntime, evaluateTargetStatically, runtimeValuesEqual } from './ast-evaluator.js';
import {
  ComprehensiveOracle,
  hasValidTesterApprovalAudit,
  OracleGateResult,
  OracleGateStatus,
} from './oracle-taxonomy.js';
import { migrateTestCaseV1ToV2 } from '../plan-migrator.js';

export interface UnitOracleGateResolution {
  testCaseId: string;
  gateStatus: OracleGateStatus;
  oracle: ComprehensiveOracle;
  reason?: string;
  specExpected?: UnitExpectedResult;
  errors: string[];
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

function specificationConflict(
  target: UnitTarget,
  testCase: UnitPlannedTestCase,
): { expected: unknown; actual: unknown } | undefined {
  const evaluated = evaluateTargetStatically(target, testCase.inputs, testCase.mocks);
  if (!evaluated.supported) return undefined;
  const expectsThrow = testCase.expected.kind === 'throw' || testCase.expected.kind === 'reject';
  const matches = evaluated.kind === 'throw'
    ? expectsThrow && expectedErrorMatches(testCase.expected, evaluated)
    : !expectsThrow
      && ['return', 'resolve'].includes(testCase.expected.kind)
      && runtimeValuesEqual(evaluated.value, dataValueToRuntime(testCase.expected.value!));
  if (matches) return undefined;
  return {
    expected: testCase.expected.value !== undefined ? testCase.expected.value : testCase.expected.kind,
    actual: evaluated.kind === 'throw'
      ? `${evaluated.errorClass}: ${evaluated.message}`
      : evaluated.value,
  };
}

function conflictResolution(
  testCase: UnitPlannedTestCase,
  oracle: ComprehensiveOracle,
  conflict: { expected: unknown; actual: unknown },
): UnitOracleGateResolution {
  return {
    testCaseId: testCase.id,
    gateStatus: 'CONFLICT_WITH_SPEC',
    oracle,
    reason: `Mâu thuẫn với Specification: mong đợi ${JSON.stringify(conflict.expected)} nhưng implementation hiện tại trả về ${JSON.stringify(conflict.actual)}`,
    specExpected: testCase.expected,
    errors: ['Source implementation conflicts with specification'],
  };
}

export function evaluateOracleGate(
  context: Pick<UnitContextBundle, 'requirements'>,
  target: UnitTarget,
  rawTestCase: UnitPlannedTestCase,
): UnitOracleGateResolution {
  const testCase = migrateTestCaseV1ToV2(rawTestCase);
  const oracle = testCase.oracle!;

  const schemaIssues = validateExpectedIntent(testCase.expected);
  if (schemaIssues.length > 0) {
    return {
      testCaseId: testCase.id,
      gateStatus: 'INVALID_EVIDENCE',
      oracle,
      reason: `Schema expected không hợp lệ: ${schemaIssues.map(i => i.message).join(', ')}`,
      errors: schemaIssues.map(issue => `${issue.path}: ${issue.message}`),
    };
  }

  // 1. SPECIFICATION từ Requirement hoặc Tester Confirmation
  if (oracle.intentType === 'SPECIFICATION') {
    if (oracle.authority === 'REQUIREMENT') {
      const reference = oracle.evidence.reference?.trim();
      if (
        oracle.evidence.status !== 'VERIFIED'
        || oracle.evidence.method !== 'REQUIREMENT_REFERENCE'
        || !reference
      ) {
        return {
          testCaseId: testCase.id,
          gateStatus: 'NEEDS_ORACLE',
          oracle,
          reason: 'Oracle requirement thiếu reference mã điều khoản nghiệp vụ.',
          errors: ['Oracle requirement thiếu exact reference.'],
        };
      }
      if (!context.requirements || !normalizeText(context.requirements).includes(normalizeText(reference))) {
        return {
          testCaseId: testCase.id,
          gateStatus: 'NEEDS_ORACLE',
          oracle,
          reason: `Không tìm thấy reference "${reference}" trong tài liệu requirement được cấp.`,
          errors: ['Không tìm thấy oracle reference trong yêu cầu nghiệp vụ tester đã nhập.'],
        };
      }

      const conflict = specificationConflict(target, testCase);
      if (conflict) return conflictResolution(testCase, oracle, conflict);

      return {
        testCaseId: testCase.id,
        gateStatus: 'READY_SPECIFICATION',
        oracle,
        specExpected: testCase.expected,
        errors: [],
      };
    }

    if (oracle.authority === 'TESTER_CONFIRMATION') {
      if (!hasValidTesterApprovalAudit(oracle, testCase.expected)) {
        return {
          testCaseId: testCase.id,
          gateStatus: 'NEEDS_ORACLE',
          oracle,
          reason: 'Xác nhận tester không có audit entry hợp lệ từ phiên interactive.',
          errors: ['Xác nhận tester thiếu audit APPROVE_EXPECTED/REPLACE_EXPECTED hợp lệ.'],
        };
      }
      const conflict = specificationConflict(target, testCase);
      if (conflict) return conflictResolution(testCase, oracle, conflict);
      return {
        testCaseId: testCase.id,
        gateStatus: 'READY_SPECIFICATION',
        oracle,
        specExpected: testCase.expected,
        errors: [],
      };
    }
  }

  // 2. CHARACTERIZATION từ Static Evaluation / Implementation
  if (oracle.intentType === 'CHARACTERIZATION') {
    if (oracle.authority === 'EXISTING_TEST') {
      if (
        oracle.evidence.status === 'VERIFIED'
        && oracle.evidence.method === 'EXISTING_TEST_REFERENCE'
        && oracle.evidence.reference?.trim()
      ) {
        return {
          testCaseId: testCase.id,
          gateStatus: 'READY_CHARACTERIZATION',
          oracle,
          errors: [],
        };
      }
      return {
        testCaseId: testCase.id,
        gateStatus: 'INVALID_EVIDENCE',
        oracle,
        reason: 'Existing test characterization thiếu reference đã xác minh.',
        errors: ['Existing test characterization thiếu reference đã xác minh.'],
      };
    }

    if (
      oracle.evidence.method === 'SANDBOX_OBSERVATION'
      && oracle.evidence.status === 'OBSERVED'
      && oracle.evidence.reference?.trim()
    ) {
      return {
        testCaseId: testCase.id,
        gateStatus: 'READY_CHARACTERIZATION',
        oracle,
        errors: [],
      };
    }

    const evaluated = evaluateTargetStatically(target, testCase.inputs, testCase.mocks);
    if (!evaluated.supported) {
      return {
        testCaseId: testCase.id,
        gateStatus: 'NEEDS_ORACLE',
        oracle,
        reason: `Không thể chứng minh expected bằng static evaluator: ${evaluated.reason}`,
        errors: [`Không thể chứng minh expected bằng static evaluator: ${evaluated.reason}`],
      };
    }

    // Check if proposed expected matches evaluation
    const expectedKind = testCase.expected.kind;
    const expectsThrow = expectedKind === 'throw' || expectedKind === 'reject';
    let matches = true;

    if (evaluated.kind === 'throw') {
      if (!expectsThrow || !expectedErrorMatches(testCase.expected, evaluated)) {
        matches = false;
      }
    } else {
      if (expectsThrow || !['return', 'resolve'].includes(expectedKind) ||
          !runtimeValuesEqual(evaluated.value, dataValueToRuntime(testCase.expected.value!))) {
        matches = false;
      }
    }

    if (!matches && oracle.authority === 'IMPLEMENTATION') {
      return {
        testCaseId: testCase.id,
        gateStatus: 'NEEDS_ORACLE',
        oracle,
        reason: 'Expected value không khớp kết quả được chứng minh từ implementation.',
        errors: ['Expected value không khớp kết quả được chứng minh từ implementation.'],
      };
    }

    return {
      testCaseId: testCase.id,
      gateStatus: 'READY_CHARACTERIZATION',
      oracle: {
        ...oracle,
        evidence: {
          ...oracle.evidence,
          status: 'VERIFIED',
          method: testCase.mocks.length > 0 ? 'MOCK_TRACE' : 'STATIC_EVALUATION',
          reference: oracle.evidence.reference || evaluated.expression,
        },
      },
      errors: [],
    };
  }

  return {
    testCaseId: testCase.id,
    gateStatus: 'NEEDS_ORACLE',
    oracle,
    reason: 'Chưa đủ bằng chứng xác minh Oracle',
    errors: ['Undefined oracle status'],
  };
}

export function resolveTargetOraclesV2(
  context: Pick<UnitContextBundle, 'requirements'>,
  target: UnitTarget,
  testCases: UnitPlannedTestCase[],
): UnitOracleGateResolution[] {
  return testCases.map(testCase => evaluateOracleGate(context, target, testCase));
}

// BACKWARD COMPATIBILITY ADAPTERS FOR V1 CALLERS
export type UnitOracleResolutionStatus = 'VERIFIED' | 'NEEDS_ORACLE';

export interface UnitOracleResolution {
  testCaseId: string;
  status: UnitOracleResolutionStatus;
  evidence?: UnitOracleEvidence;
  errors: string[];
}

export function resolveUnitTestOracle(
  context: Pick<UnitContextBundle, 'requirements'>,
  target: UnitTarget,
  testCase: UnitPlannedTestCase,
): UnitOracleResolution {
  const gate = evaluateOracleGate(context, target, testCase);
  if (gate.gateStatus === 'READY_SPECIFICATION' || gate.gateStatus === 'READY_CHARACTERIZATION' || gate.gateStatus === 'CONFLICT_WITH_SPEC') {
    const evaluated = evaluateTargetStatically(target, testCase.inputs, testCase.mocks);
    let evidenceSource: UnitOracleEvidence['source'] = evaluated.supported
      ? (testCase.mocks && testCase.mocks.length > 0 ? 'mock-trace' : 'pure-evaluation')
      : 'ai-inference';
    if (gate.oracle.authority === 'TESTER_CONFIRMATION') {
      evidenceSource = 'tester-confirmation';
    } else if (gate.oracle.authority === 'REQUIREMENT') {
      evidenceSource = 'requirement';
    }

    const legacySource = testCase.oracleEvidence?.source;
    const finalSource = ['TESTER_CONFIRMATION', 'REQUIREMENT'].includes(gate.oracle.authority)
      ? evidenceSource
      : (legacySource && legacySource !== 'ai-inference')
      ? legacySource
      : evidenceSource;

    return {
      testCaseId: testCase.id,
      status: 'VERIFIED',
      evidence: {
        status: 'verified',
        source: finalSource,
        reference: testCase.oracleEvidence?.reference || gate.oracle.evidence.reference,
        expression: testCase.oracleEvidence?.expression
          || (evaluated.supported ? evaluated.expression : undefined),
      },
      errors: [],
    };
  }

  return {
    testCaseId: testCase.id,
    status: 'NEEDS_ORACLE',
    errors: gate.errors.length > 0 ? gate.errors : [gate.reason || 'Needs Oracle'],
  };
}

export function resolveTargetOracles(
  context: Pick<UnitContextBundle, 'requirements'>,
  target: UnitTarget,
  testCases: UnitPlannedTestCase[],
): UnitOracleResolution[] {
  return testCases.map(testCase => resolveUnitTestOracle(context, target, testCase));
}
