import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  typecheckGeneratedUnitFile,
  validateGeneratedUnitCode,
} from '../../src/agents/generator/unit-generator.js';
import type { UnitPlanTarget, UnitTarget } from '../../src/core/unit/schema.js';

const target: UnitTarget = {
  id: 'src/discount.ts#applyDiscount', sourceFile: 'src/discount.ts', sourceHash: 'hash',
  symbol: 'applyDiscount', kind: 'function', exported: true, defaultExport: false, async: false,
  parameters: [], returnType: 'number', startLine: 1, endLine: 1,
  rawCode: 'export function applyDiscount() { return 90; }',
  dependencies: [],
  supportingContext: {
    callGraph: [], helperDefinitions: [], typeDefinitions: [], constantDefinitions: [],
    reachableImports: [], unresolvedSymbols: [], truncated: false,
  },
  branches: [{ id: 'B001_PATH', kind: 'if', condition: 'default', outcome: 'return', line: 1 }],
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
  it('typechecks a generated file before accepting it', () => {
    const goodFile = path.join(process.cwd(), 'tests', 'unit', '.unit-preflight-good.ts');
    const badFile = path.join(process.cwd(), 'tests', 'unit', '.unit-preflight-bad.ts');
    try {
      fs.writeFileSync(goodFile, 'const value: number = 1; export { value };\n');
      fs.writeFileSync(badFile, "const value: number = 'wrong'; export { value };\n");
      expect(typecheckGeneratedUnitFile(process.cwd(), goodFile)).toEqual([]);
      expect(typecheckGeneratedUnitFile(process.cwd(), badFile).join('\n')).toContain("not assignable to type 'number'");
    } finally {
      fs.rmSync(goodFile, { force: true });
      fs.rmSync(badFile, { force: true });
    }
  });

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

  it('blocks nested mocks and non-hoisted mock factory references', () => {
    const mockedTarget: UnitTarget = {
      ...target,
      dependencies: [{
        module: 'openai', importedNames: ['OpenAI'], external: true,
        boundary: 'network', strategy: 'mock',
      }],
      executionMode: 'NATIVE_WITH_MOCKS',
    };
    const mockedPlan: UnitPlanTarget = {
      ...planTarget,
      executionMode: 'NATIVE_WITH_MOCKS',
      testCases: planTarget.testCases.map(testCase => ({
        ...testCase,
        mocks: [{ module: 'openai', symbol: 'OpenAI', behavior: 'returns output' }],
      })),
    };
    const code = `
import { describe, expect, it, vi } from 'vitest';
import { applyDiscount } from '../../../src/discount';
const output = 'unsafe';
describe('applyDiscount', () => {
  vi.mock('openai', () => ({ default: vi.fn(() => output) }));
  it('UT_DISCOUNT_001 - returns discount', () => expect(applyDiscount()).toBe(90));
});`;
    const result = validateGeneratedUnitCode({
      code, target: mockedTarget, planTarget: mockedPlan,
      importPath: '../../../src/discount', framework: 'vitest',
      dependencyPaths: new Map([['openai', 'openai']]),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('top-level'),
      expect.stringContaining('chưa vi.hoisted'),
    ]));
  });

  it('accepts one self-contained top-level mock for a verified dependency', () => {
    const mockedTarget: UnitTarget = {
      ...target,
      dependencies: [{
        module: 'openai', importedNames: ['OpenAI'], external: true,
        boundary: 'network', strategy: 'mock',
      }],
      executionMode: 'NATIVE_WITH_MOCKS',
    };
    const mockedPlan: UnitPlanTarget = {
      ...planTarget,
      executionMode: 'NATIVE_WITH_MOCKS',
      testCases: planTarget.testCases.map(testCase => ({
        ...testCase,
        mocks: [{ module: 'openai', symbol: 'OpenAI', behavior: 'returns fixed client' }],
      })),
    };
    const code = `
import { describe, expect, it, vi } from 'vitest';
vi.mock('openai', () => ({ default: vi.fn(() => ({ ok: true })) }));
import { applyDiscount } from '../../../src/discount';
describe('applyDiscount', () => {
  it('UT_DISCOUNT_001 - returns discount', () => expect(applyDiscount()).toBe(90));
});`;
    expect(validateGeneratedUnitCode({
      code, target: mockedTarget, planTarget: mockedPlan,
      importPath: '../../../src/discount', framework: 'vitest',
      dependencyPaths: new Map([['openai', 'openai']]),
    })).toEqual({ ok: true, errors: [] });
  });
});
