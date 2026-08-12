import { describe, expect, it } from 'vitest';
import {
  validateStructuredUnitPlan,
} from '../../src/core/unit/plan-validator.js';
import type {
  StructuredUnitPlan,
  UnitContextBundle,
  UnitTarget,
} from '../../src/core/unit/schema.js';

function target(): UnitTarget {
  return {
    id: 'src/discount.ts#applyDiscount', sourceFile: 'src/discount.ts', sourceHash: 'hash-123',
    symbol: 'applyDiscount', kind: 'function', exported: true, defaultExport: false, async: false,
    parameters: [{ name: 'total', type: 'number', optional: false }], returnType: 'number',
    startLine: 1, endLine: 4, rawCode: 'export function applyDiscount(total: number) { return total; }',
    dependencies: [{ module: './db', importedNames: ['db'], external: false, boundary: 'database', strategy: 'mock', resolvedFile: 'src/db.ts' }],
    supportingContext: {
      callGraph: [], helperDefinitions: [], typeDefinitions: [], constantDefinitions: [],
      reachableImports: [{
        sourceFile: 'src/discount.ts', module: './db', importedNames: ['db'], resolvedFile: 'src/db.ts',
      }],
      unresolvedSymbols: [], truncated: false,
    },
    branches: [
      { id: 'B001_TRUE', kind: 'if', condition: 'total <= 0', outcome: 'throw', line: 2 },
      { id: 'B001_FALSE', kind: 'if', condition: 'total <= 0', outcome: 'continue', line: 2 },
    ],
    executionMode: 'NATIVE_WITH_MOCKS', unsupportedReasons: [],
  };
}

function context(): UnitContextBundle {
  return {
    version: 1,
    project: {
      version: 1, projectName: 'shop', projectRoot: '/project', packageType: 'module',
      language: 'typescript', testFramework: 'vitest', packageManager: 'npm',
      sourceFiles: ['src/discount.ts'], configFiles: ['package.json'], scannedAt: '2026-08-11T00:00:00.000Z',
    },
    targets: [target()],
  };
}

function validPlan(): StructuredUnitPlan {
  return {
    version: 1, source: 'ai-planner',
    project: { name: 'shop', root: '/project', testFramework: 'vitest' },
    targets: [{
      sourceFile: 'src/discount.ts', symbol: 'applyDiscount', sourceHash: 'hash-123', executionMode: 'NATIVE_WITH_MOCKS',
      testCases: [
        {
          id: 'UT_DISCOUNT_001', name: 'reject invalid total', branchIds: ['B001_TRUE'], inputs: { total: 0 },
          expected: { kind: 'throw', message: 'INVALID_TOTAL' }, oracleSource: 'implementation',
          mocks: [{ module: './db', symbol: 'db', behavior: 'not called' }],
        },
        {
          id: 'UT_DISCOUNT_002', name: 'returns valid total', branchIds: ['B001_FALSE'], inputs: { total: 100 },
          expected: { kind: 'return', value: 100 }, oracleSource: 'implementation',
          mocks: [{ module: './db', symbol: 'db', behavior: 'returns no persisted discount' }],
        },
      ],
    }],
    clarifications: [],
  };
}

describe('Structured Unit Plan validator', () => {
  it('accepts a plan grounded in source hash, branch map, and dependency map', () => {
    expect(validateStructuredUnitPlan(validPlan(), context())).toEqual([]);
  });

  it('allows supplemental constructor/setup tests without a branch ID when real branches remain covered', () => {
    const plan = validPlan();
    plan.targets[0].testCases.unshift({
      id: 'UT_DISCOUNT_000',
      name: 'initializes exported module metadata',
      branchIds: [],
      inputs: { total: 100 },
      expected: { kind: 'side-effect', calls: [] },
      oracleSource: 'type-contract',
      mocks: [{ module: './db', symbol: 'db', behavior: 'isolated during module setup' }],
    });

    expect(validateStructuredUnitPlan(plan, context())).toEqual([]);
  });

  it('blocks invented branches, mocks, and stale source hashes', () => {
    const plan = validPlan();
    plan.targets[0].sourceHash = 'stale';
    plan.targets[0].testCases[0].branchIds = ['B999_FAKE'];
    plan.targets[0].testCases[0].mocks = [{ module: './invented', behavior: 'anything' }];
    const codes = validateStructuredUnitPlan(plan, context()).map(issue => issue.code);

    expect(codes).toContain('STALE_OR_INVENTED_SOURCE_HASH');
    expect(codes).toContain('INVENTED_BRANCH');
    expect(codes).toContain('INVENTED_MOCK');
    expect(codes).toContain('UNCOVERED_BRANCH');
  });

  it('requires safety-boundary mocks and blocks mocking real dependencies', () => {
    const ctx = context();
    ctx.targets[0].dependencies.push({
      module: './math', importedNames: ['round'], external: false,
      boundary: 'internal', strategy: 'real', resolvedFile: 'src/math.ts',
    });
    const plan = validPlan();
    plan.targets[0].testCases[0].mocks = [{ module: './math', behavior: 'fake rounding' }];
    const codes = validateStructuredUnitPlan(plan, ctx).map(issue => issue.code);

    expect(codes).toContain('MOCK_OF_REAL_DEPENDENCY');
    expect(codes).toContain('MISSING_REQUIRED_MOCK');
  });

  it('preserves Map return types in async oracles', () => {
    const ctx = context();
    ctx.targets[0].async = true;
    ctx.targets[0].returnType = 'Promise<Map<string, number>>';
    const plan = validPlan();
    plan.targets[0].testCases.forEach(testCase => {
      testCase.expected = {
        kind: 'resolve',
        value: { $type: 'map', entries: [['total', 100]] },
      };
    });
    expect(validateStructuredUnitPlan(plan, ctx)).toEqual([]);

    plan.targets[0].testCases[0].expected = { kind: 'resolve', value: { total: 100 } };
    expect(validateStructuredUnitPlan(plan, ctx).map(issue => issue.code))
      .toContain('RETURN_TYPE_ORACLE_MISMATCH');
  });

  it('blocks missing, invented, and primitive-mismatched function inputs', () => {
    const plan = validPlan();
    plan.targets[0].testCases[0].inputs = { total: 'not-a-number', invented: true };
    const codes = validateStructuredUnitPlan(plan, context()).map(issue => issue.code);

    expect(codes).toContain('INPUT_TYPE_MISMATCH');
    expect(codes).toContain('INVENTED_INPUT');

    plan.targets[0].testCases[0].inputs = {};
    expect(validateStructuredUnitPlan(plan, context()).map(issue => issue.code))
      .toContain('MISSING_REQUIRED_INPUT');
  });
});
