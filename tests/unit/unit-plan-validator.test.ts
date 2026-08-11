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
          expected: { kind: 'return', value: 100 }, oracleSource: 'implementation', mocks: [],
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
});
