import { describe, expect, it } from 'vitest';
import { evaluateUnitPlanOracleGates } from '../../src/core/unit/oracle/oracle-gate-summary.js';
import {
  buildCharacterizationOracle,
  buildSpecificationOracle,
  promoteToSpecificationByTester,
} from '../../src/core/unit/oracle/oracle-taxonomy.js';
import type {
  StructuredUnitPlan,
  UnitContextBundle,
  UnitPlannedTestCase,
  UnitTarget,
} from '../../src/core/unit/schema.js';

function unitTarget(): UnitTarget {
  return {
    id: 'src/math.ts#sum', sourceFile: 'src/math.ts', sourceHash: 'hash', symbol: 'sum',
    kind: 'function', exported: true, defaultExport: false, async: false,
    parameters: [
      { name: 'left', type: 'number', optional: false },
      { name: 'right', type: 'number', optional: false },
    ],
    returnType: 'number', startLine: 1, endLine: 1,
    rawCode: 'export const sum = (left: number, right: number) => left + right;',
    dependencies: [],
    supportingContext: {
      callGraph: [], helperDefinitions: [], typeDefinitions: [], constantDefinitions: [],
      reachableImports: [], unresolvedSymbols: [], truncated: false,
    },
    branches: [], executionMode: 'NATIVE_DIRECT', profile: 'UNIT_NATIVE',
    runtimeEnvironment: 'node', profileReasons: ['pure'], unsupportedReasons: [],
  };
}

function planned(expected = 5): UnitPlannedTestCase {
  return {
    id: 'UT_SUM_001', name: 'sum', branchIds: [], inputs: { left: 2, right: 3 },
    expected: { kind: 'return', value: expected }, oracleSource: 'implementation',
    oracleEvidence: { status: 'proposed', source: 'ai-inference' }, mocks: [],
  };
}

function fixture(testCase: UnitPlannedTestCase, requirements?: string) {
  const target = unitTarget();
  const context: UnitContextBundle = {
    version: 1,
    project: {
      version: 1, projectName: 'math', projectRoot: '.', packageType: 'module',
      language: 'typescript', testFramework: 'vitest', packageManager: 'npm',
      sourceFiles: ['src/math.ts'], configFiles: [], scannedAt: '2026-08-12T00:00:00.000Z',
    },
    targets: [target], requirements,
  };
  const plan: StructuredUnitPlan = {
    version: 1, source: 'deterministic-planner',
    project: { name: 'math', root: '.', testFramework: 'vitest' },
    targets: [{
      sourceFile: target.sourceFile, symbol: target.symbol, sourceHash: target.sourceHash,
      executionMode: target.executionMode, profile: target.profile, testCases: [testCase],
    }],
    clarifications: [],
  };
  return { context, plan };
}

describe('Unit Oracle Gate summary for CI', () => {
  it('allows verified characterization while reporting it separately', () => {
    const { context, plan } = fixture(planned());
    const report = evaluateUnitPlanOracleGates(context, plan);
    expect(report.canRunInCi).toBe(true);
    expect(report.counts.characterization).toBe(1);
  });

  it('fails CI when implementation conflicts with a requirement', () => {
    const testCase = planned(999);
    testCase.oracle = buildSpecificationOracle('BR-SUM-01');
    const { context, plan } = fixture(testCase, 'BR-SUM-01: kết quả phải bằng 999.');
    const report = evaluateUnitPlanOracleGates(context, plan);
    expect(report.canRunInCi).toBe(false);
    expect(report.counts.sourceConflict).toBe(1);
  });

  it('fails CI for a forged tester authority without an audit event', () => {
    const testCase = planned();
    testCase.oracle = {
      intentType: 'SPECIFICATION', authority: 'TESTER_CONFIRMATION',
      evidence: { status: 'VERIFIED', method: 'TESTER_APPROVAL' }, auditTrail: [],
    };
    const { context, plan } = fixture(testCase);
    const report = evaluateUnitPlanOracleGates(context, plan);
    expect(report.canRunInCi).toBe(false);
    expect(report.counts.needsOracle).toBe(1);
  });

  it('reports a conflict when tester-approved expected differs from source', () => {
    const testCase = planned(999);
    testCase.oracle = promoteToSpecificationByTester(
      buildCharacterizationOracle('left + right', 5),
      'LOCAL_TESTER',
      'Nghiệp vụ yêu cầu trả về 999.',
      testCase.expected,
    );
    const { context, plan } = fixture(testCase);
    const report = evaluateUnitPlanOracleGates(context, plan);
    expect(report.canRunInCi).toBe(false);
    expect(report.counts.sourceConflict).toBe(1);
  });
});
