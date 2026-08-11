import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { loadUnitSession } from './artifacts.js';

export interface UnitRunResult {
  ok: boolean;
  framework: 'vitest' | 'jest' | 'unknown';
  command: string[];
  cwd: string;
  generatedFiles: string[];
  coverageEnabled: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function packageJson(root: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function hasVitestCoverage(root: string): boolean {
  const pkg = packageJson(root) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return Boolean(dependencies['@vitest/coverage-v8'] || dependencies['@vitest/coverage-istanbul']);
}

function findLocalRunner(root: string, framework: 'vitest' | 'jest'): string | undefined {
  const executable = process.platform === 'win32' ? `${framework}.cmd` : framework;
  let current = root;
  while (true) {
    const candidate = path.join(current, 'node_modules', '.bin', executable);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function runLastGeneratedUnitTests(): UnitRunResult {
  const session = loadUnitSession();
  const generatedFiles = session.generatedFiles.filter(file => fs.existsSync(file));
  if (generatedFiles.length === 0) {
    return {
      ok: false,
      framework: session.testFramework,
      command: [],
      cwd: session.projectRoot,
      generatedFiles: [],
      coverageEnabled: false,
      stdout: '',
      stderr: 'Unit session chưa có file test đã sinh hoặc file đã bị xoá.',
      exitCode: null,
    };
  }
  if (session.testFramework === 'unknown') {
    return {
      ok: false,
      framework: 'unknown',
      command: [],
      cwd: session.projectRoot,
      generatedFiles,
      coverageEnabled: false,
      stdout: '',
      stderr: 'Dự án chưa cấu hình Vitest/Jest.',
      exitCode: null,
    };
  }

  const coverageEnabled = session.testFramework === 'jest' || hasVitestCoverage(session.projectRoot);
  const relativeFiles = generatedFiles.map(file => path.relative(session.projectRoot, file));
  const executable = findLocalRunner(session.projectRoot, session.testFramework);
  if (!executable) {
    return {
      ok: false,
      framework: session.testFramework,
      command: [],
      cwd: session.projectRoot,
      generatedFiles,
      coverageEnabled: false,
      stdout: '',
      stderr: `${session.testFramework} được khai báo nhưng chưa có trong node_modules. Hãy chạy lệnh cài dependency của dự án đích; TestKit không tự tải package.`,
      exitCode: null,
    };
  }
  const args = session.testFramework === 'vitest'
    ? ['run', ...relativeFiles, ...(coverageEnabled ? ['--coverage'] : [])]
    : [...relativeFiles, ...(coverageEnabled ? ['--coverage'] : [])];
  const result = spawnSync(executable, args, {
    cwd: session.projectRoot,
    encoding: 'utf-8',
    windowsHide: false,
    shell: false,
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const runResult: UnitRunResult = {
    ok: result.status === 0,
    framework: session.testFramework,
    command: [executable, ...args],
    cwd: session.projectRoot,
    generatedFiles,
    coverageEnabled,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
    exitCode: result.status,
  };
  fs.writeFileSync(
    path.join(session.runDirectory, 'test-results.json'),
    `${JSON.stringify({ ...runResult, ranAt: new Date().toISOString() }, null, 2)}\n`,
  );
  const coverageCandidates = [
    path.join(session.projectRoot, 'coverage', 'coverage-summary.json'),
    path.join(session.projectRoot, 'coverage', 'coverage-final.json'),
  ];
  const coverageFile = coverageCandidates.find(file => fs.existsSync(file));
  fs.writeFileSync(
    path.join(session.runDirectory, 'coverage-gaps.json'),
    `${JSON.stringify({
      version: 1,
      coverageEnabled,
      coverageFile: coverageFile || null,
      status: coverageEnabled
        ? coverageFile ? 'COVERAGE_AVAILABLE' : 'COVERAGE_REPORT_NOT_FOUND'
        : 'COVERAGE_PLUGIN_NOT_INSTALLED',
      note: coverageEnabled
        ? 'Coverage được giữ trong dự án đích; vòng bổ sung branch sẽ đọc report này ở giai đoạn tiếp theo.'
        : 'Test vẫn được chạy, nhưng cần cài coverage provider tương ứng để đo coverage.',
    }, null, 2)}\n`,
  );
  return runResult;
}
