import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeUnitInput } from '../../src/core/unit/artifacts.js';

const temporaryDirectories: string[] = [];

function createProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testkit-unit-reader-'));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'sample-business-project',
    type: 'module',
    devDependencies: { vitest: '^4.0.0' },
  }));
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=do-not-read');
  fs.writeFileSync(path.join(root, 'tests', 'old.test.ts'), 'export const ignored = true;');
  fs.writeFileSync(path.join(root, 'src', 'order-repository.ts'), 'export const orderRepository = { find: async () => null };');
  fs.writeFileSync(path.join(root, 'src', 'discount.ts'), `
import { orderRepository } from './order-repository';

export async function applyDiscount(total: number, code: string): Promise<number> {
  const password = 'hard-coded-secret';
  await orderRepository.find();
  if (total <= 0) throw new Error('INVALID_TOTAL');
  return code === 'SALE10' ? total * 0.9 : total;
}

function privateHelper(value: number) {
  return value * 2;
}
`);
  return root;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('Unit Code Reader', () => {
  it('scans a JS/TS project without reading secrets, tests, or node_modules', () => {
    const root = createProject();
    const analysis = analyzeUnitInput(root);

    expect(analysis.manifest.projectName).toBe('sample-business-project');
    expect(analysis.manifest.testFramework).toBe('vitest');
    expect(analysis.manifest.sourceFiles).toEqual([
      'src/discount.ts',
      'src/order-repository.ts',
    ]);
    expect(analysis.manifest.sourceFiles).not.toContain('.env');
    expect(analysis.manifest.sourceFiles).not.toContain('tests/old.test.ts');
  });

  it('extracts exported targets, branches, hashes, and mock boundaries from AST', () => {
    const root = createProject();
    const analysis = analyzeUnitInput(path.join(root, 'src', 'discount.ts'));
    const target = analysis.index.targets.find(item => item.symbol === 'applyDiscount');

    expect(target).toBeDefined();
    expect(target?.exported).toBe(true);
    expect(target?.async).toBe(true);
    expect(target?.parameters.map(parameter => parameter.name)).toEqual(['total', 'code']);
    expect(target?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(target?.branches.map(branch => branch.id)).toEqual([
      'B001_TRUE', 'B001_FALSE', 'B002_TRUE', 'B002_FALSE',
    ]);
    expect(target?.dependencies).toEqual([
      expect.objectContaining({
        module: './order-repository',
        boundary: 'database',
        strategy: 'mock',
        resolvedFile: 'src/order-repository.ts',
      }),
    ]);
    expect(target?.executionMode).toBe('NATIVE_WITH_MOCKS');
    expect(target?.rawCode).toContain("password = '<REDACTED>'");
    expect(target?.rawCode).not.toContain('hard-coded-secret');

    const privateTarget = analysis.index.targets.find(item => item.symbol === 'privateHelper');
    expect(privateTarget?.executionMode).toBe('UNSUPPORTED');
  });
});
