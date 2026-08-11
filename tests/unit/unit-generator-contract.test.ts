import { describe, expect, it } from 'vitest';
import { validateGeneratedUnitCode } from '../../src/agents/generator/unit-generator.js';
import type { UnitPlanTarget, UnitTarget } from '../../src/core/unit/schema.js';

const target: UnitTarget = {
  id: 'src/discount.ts#applyDiscount', sourceFile: 'src/discount.ts', sourceHash: 'hash',
  symbol: 'applyDiscount', kind: 'function', exported: true, defaultExport: false, async: false,
  parameters: [], returnType: 'number', startLine: 1, endLine: 1,
  rawCode: 'export function applyDiscount() { return 90; }',
  dependencies: [], branches: [{ id: 'B001_PATH', kind: 'if', condition: 'default', outcome: 'return', line: 1 }],
  executionMode: 'NATIVE_DIRECT', unsupportedReasons: [],
};
const planTarget: UnitPlanTarget = {
  sourceFile: target.sourceFile, symbol: target.symbol, sourceHash: target.sourceHash,
  executionMode: target.executionMode,
  testCases: [{
    id: 'UT_DISCOUNT_001', name: 'returns discount', branchIds: ['B001_PATH'], inputs: {},
    expected: { kind: 'return', value: 90 }, oracleSource: 'implementation', mocks: [],
  }],
};

describe('Unit Generator contract', () => {
  it('accepts a test that imports the real source', () => {
    const code = `
import { describe, expect, it } from 'vitest';
import { applyDiscount } from '../../../src/discount';
describe('applyDiscount', () => {
  it('UT_DISCOUNT_001 - returns discount', () => {
    expect(applyDiscount()).toBe(90);
  });
});`;
    expect(validateGeneratedUnitCode({
      code, target, planTarget, importPath: '../../../src/discount', framework: 'vitest', dependencyPaths: new Map(),
    })).toEqual({ ok: true, errors: [] });
  });

  it('blocks pasted production code and skipped tests', () => {
    const code = `
import { describe, expect, it } from 'vitest';
import { applyDiscount } from '../../../src/discount';
function applyDiscount() { return 90; }
it.skip('UT_DISCOUNT_001', () => expect(applyDiscount()).toBe(90));`;
    const result = validateGeneratedUnitCode({
      code, target, planTarget, importPath: '../../../src/discount', framework: 'vitest', dependencyPaths: new Map(),
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('copy hàm'),
      expect.stringContaining('skip/only/todo'),
    ]));
  });
});
