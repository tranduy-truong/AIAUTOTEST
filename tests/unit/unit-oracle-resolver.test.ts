import { describe, expect, it } from 'vitest';
import { compileUnitTestFile } from '../../src/core/unit/compiler/test-file-compiler.js';
import { resolveUnitTestOracle } from '../../src/core/unit/oracle/oracle-resolver.js';
import { prepareOracleVerifiedPlan } from '../../src/agents/generator/unit-generator.js';
import type { UnitPlannedTestCase, UnitTarget } from '../../src/core/unit/schema.js';

function target(rawCode = 'export const sum = (left: number, right: number) => left + right;'): UnitTarget {
  return {
    id: 'src/math.ts#sum', sourceFile: 'src/math.ts', sourceHash: 'hash', symbol: 'sum',
    kind: 'function', exported: true, defaultExport: false, async: false,
    parameters: [
      { name: 'left', type: 'number', optional: false },
      { name: 'right', type: 'number', optional: false },
    ],
    returnType: 'number', startLine: 1, endLine: 1, rawCode,
    dependencies: [],
    supportingContext: {
      callGraph: [], helperDefinitions: [], typeDefinitions: [], constantDefinitions: [],
      reachableImports: [], unresolvedSymbols: [], truncated: false,
    },
    branches: [{ id: 'B001_PATH', kind: 'if', condition: 'default', outcome: 'return', line: 1 }],
    executionMode: 'NATIVE_DIRECT', profile: 'UNIT_NATIVE', runtimeEnvironment: 'node',
    profileReasons: ['pure'], unsupportedReasons: [],
  };
}

function planned(expectedValue: number): UnitPlannedTestCase {
  return {
    id: 'UT_SUM_001', name: 'adds', branchIds: ['B001_PATH'],
    inputs: { left: 2, right: 3 }, expected: { kind: 'return', value: expectedValue },
    oracleSource: 'implementation',
    oracleEvidence: { status: 'proposed', source: 'ai-inference' },
    mocks: [],
  };
}

describe('Unit Oracle Resolver', () => {
  it('verifies a pure result by evaluating a safe AST subset', () => {
    const result = resolveUnitTestOracle({}, target(), planned(5));
    expect(result.status).toBe('VERIFIED');
    expect(result.evidence).toMatchObject({ status: 'verified', source: 'pure-evaluation' });
  });

  it('rejects an AI-proposed value that does not match the implementation', () => {
    const result = resolveUnitTestOracle({}, target(), planned(6));
    expect(result.status).toBe('NEEDS_ORACLE');
    expect(result.errors.join(' ')).toContain('không khớp');
  });

  it('requires requirement evidence to be an exact excerpt of tester input', () => {
    const testCase = planned(999);
    testCase.oracleSource = 'requirement';
    testCase.oracleEvidence = {
      status: 'verified', source: 'requirement', reference: 'Kết quả phải bằng 999',
    };
    expect(resolveUnitTestOracle({ requirements: 'Quy định: Kết quả phải bằng 999.' }, target(), testCase).status)
      .toBe('VERIFIED');
    expect(resolveUnitTestOracle({ requirements: 'Không có expected.' }, target(), testCase).status)
      .toBe('NEEDS_ORACLE');
  });

  it('does not statically execute a target with mocked IO dependencies', () => {
    const ioTarget: UnitTarget = {
      ...target('export function sum(left: number, right: number) { return fs.readFileSync("x"); }'),
      dependencies: [{
        module: 'fs', importedNames: ['default'], external: true, boundary: 'filesystem',
        strategy: 'mock', usedMembers: ['readFileSync'],
      }],
      executionMode: 'NATIVE_WITH_MOCKS', profile: 'PROCESS_SANDBOX',
    };
    const result = resolveUnitTestOracle({}, ioTarget, planned(5));
    expect(result.status).toBe('NEEDS_ORACLE');
    expect(result.errors.join(' ')).toContain('dependency mock');
  });

  it('verifies a literal thrown error and compiler asserts class plus message from one call', () => {
    const errorTarget = target(`
      export function sum(left: number, right: number) {
        if (left < 0) throw new TypeError('INVALID_LEFT: must be positive');
        return left + right;
      }
    `);
    const testCase: UnitPlannedTestCase = {
      ...planned(5), inputs: { left: -1, right: 3 },
      expected: {
        kind: 'throw',
        error: { className: 'TypeError', message: { match: 'contains', value: 'INVALID_LEFT' } },
      },
    };
    expect(resolveUnitTestOracle({}, errorTarget, testCase).status).toBe('VERIFIED');
    const result = compileUnitTestFile({
      target: errorTarget,
      planTarget: {
        sourceFile: errorTarget.sourceFile, symbol: errorTarget.symbol, sourceHash: errorTarget.sourceHash,
        executionMode: errorTarget.executionMode, profile: errorTarget.profile, testCases: [testCase],
      },
      importPath: '../../../src/math.js', framework: 'vitest', dependencyPaths: new Map(),
    });
    expect(result.code).toContain('let caughtError: unknown');
    expect(result.code).toContain('toBeInstanceOf(TypeError)');
    expect(result.code).toContain("expect.stringContaining(\"INVALID_LEFT\")");
    expect(result.code?.match(/sum\(-1, 3\)/g)).toHaveLength(1);
  });

  it('marks sandbox observations as characterization instead of business truth', () => {
    const testCase = planned(5);
    testCase.oracleSource = 'existing-test';
    testCase.oracleEvidence = { status: 'observed', source: 'sandbox-observation' };
    const result = resolveUnitTestOracle({}, target(), testCase);
    expect(result.status).toBe('NEEDS_ORACLE');
    expect(result.errors.join(' ')).toContain('characterization');
  });

  it('keeps verified cases and isolates unresolved cases in the same target', () => {
    const valid = planned(5);
    const invalid = { ...planned(6), id: 'UT_SUM_002' };
    const unitTarget = target();
    const prepared = prepareOracleVerifiedPlan({}, unitTarget, {
      sourceFile: unitTarget.sourceFile, symbol: unitTarget.symbol, sourceHash: unitTarget.sourceHash,
      executionMode: unitTarget.executionMode, profile: unitTarget.profile,
      testCases: [valid, invalid],
    });
    expect(prepared.planTarget.testCases.map(testCase => testCase.id)).toEqual(['UT_SUM_001']);
    expect(prepared.unresolvedCases).toEqual([
      expect.objectContaining({ testCaseId: 'UT_SUM_002', status: 'NEEDS_ORACLE' }),
    ]);
  });

  it('traces safe same-project helper code instead of asking AI to calculate it', () => {
    const helperTarget = target('export function sum(left: number, right: number) { return normalize(left + right); }');
    helperTarget.supportingContext.helperDefinitions = [{
      sourceFile: 'src/math.ts', sourceHash: 'hash', symbol: 'normalize', kind: 'function',
      code: 'function normalize(value: number) { return Math.max(0, value); }',
    }];
    const result = resolveUnitTestOracle({}, helperTarget, planned(5));
    expect(result.status).toBe('VERIFIED');
    expect(result.evidence?.source).toBe('pure-evaluation');
  });
});
