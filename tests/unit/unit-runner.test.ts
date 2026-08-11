import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveUnitRunnerInvocation } from '../../src/core/unit/runner.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createWindowsRunner(framework: 'vitest' | 'jest'): {
  shim: string;
  entryPoint: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-runner-'));
  temporaryDirectories.push(root);
  const shim = path.join(root, 'node_modules', '.bin', `${framework}.cmd`);
  const entryPoint = framework === 'vitest'
    ? path.join(root, 'node_modules', 'vitest', 'vitest.mjs')
    : path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');
  fs.mkdirSync(path.dirname(shim), { recursive: true });
  fs.mkdirSync(path.dirname(entryPoint), { recursive: true });
  fs.writeFileSync(shim, '@echo off\n');
  fs.writeFileSync(entryPoint, '// test CLI entry\n');
  return { shim, entryPoint };
}

describe('Unit runner invocation', () => {
  it.each(['vitest', 'jest'] as const)(
    'runs the real %s JavaScript CLI through Node on Windows',
    framework => {
      const { shim, entryPoint } = createWindowsRunner(framework);
      expect(resolveUnitRunnerInvocation(shim, framework, 'win32', 'node.exe')).toEqual({
        executable: 'node.exe',
        argsPrefix: [entryPoint],
      });
    },
  );

  it('keeps the executable shim on non-Windows platforms', () => {
    expect(resolveUnitRunnerInvocation('/project/node_modules/.bin/vitest', 'vitest', 'linux')).toEqual({
      executable: '/project/node_modules/.bin/vitest',
      argsPrefix: [],
    });
  });

  it('fails clearly when the installed Windows package has no CLI entry', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-runner-'));
    temporaryDirectories.push(root);
    const shim = path.join(root, 'node_modules', '.bin', 'vitest.cmd');
    fs.mkdirSync(path.dirname(shim), { recursive: true });
    fs.writeFileSync(shim, '@echo off\n');

    expect(() => resolveUnitRunnerInvocation(shim, 'vitest', 'win32', 'node.exe'))
      .toThrow('Không tìm thấy JavaScript CLI của vitest');
  });
});
