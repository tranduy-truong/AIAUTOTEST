import fs from 'fs';
import path from 'path';
import { sendApiRequest } from './client.js';
import { evaluateApiAssertion } from './assertions.js';
import { runDbAssertions } from './db-validator.js';
import { computeApiOracleGate } from './oracle.js';
import type {
  ApiTestResult,
  ApiTestRunResult,
  ApiTestSuite,
} from './schema.js';

export async function runApiTestSuite(suite: ApiTestSuite): Promise<ApiTestRunResult> {
  if (!suite.baseUrl) throw new Error('API baseUrl không được để trống.');
  if (!suite.tests.length) throw new Error('API test suite không có test case.');

  // Kiểm tra DB URL khi có dbAssertions
  const hasDbAssertions = suite.tests.some(tc => tc.dbAssertions?.length);
  if (hasDbAssertions && !suite.databaseUrl) {
    throw new Error(
      '[API Runner] Một số test case có dbAssertions nhưng suite.databaseUrl chưa được khai báo.',
    );
  }

  const startedAt = new Date().toISOString();
  const start = Date.now();
  const tests: ApiTestResult[] = [];

  for (const testCase of suite.tests) {
    const testStart = Date.now();
    const requestUrl = /^https?:\/\//i.test(testCase.request.path)
      ? testCase.request.path
      : new URL(
          testCase.request.path.replace(/^\/+/, ''),
          `${suite.baseUrl.replace(/\/+$/, '')}/`,
        ).toString();

    try {
      const response = await sendApiRequest(
        suite.baseUrl,
        testCase.request,
        suite.defaultHeaders || {},
      );
      const assertions = testCase.assertions.map(assertion =>
        evaluateApiAssertion(assertion, response),
      );

      // Chạy DB assertions nếu có
      let dbResults = undefined;
      if (testCase.dbAssertions?.length && suite.databaseUrl) {
        dbResults = await runDbAssertions(suite.databaseUrl, testCase.dbAssertions);
      }

      const httpOk = assertions.every(a => a.ok);
      const dbOk = !dbResults || dbResults.every(r => r.ok);

      tests.push({
        id: testCase.id,
        name: testCase.name,
        ok: httpOk && dbOk,
        durationMs: Date.now() - testStart,
        oracle: testCase.oracle,
        request: { method: testCase.request.method, url: requestUrl },
        response,
        assertions,
        dbAssertions: dbResults,
      });
    } catch (error: any) {
      tests.push({
        id: testCase.id,
        name: testCase.name,
        ok: false,
        durationMs: Date.now() - testStart,
        oracle: testCase.oracle,
        request: { method: testCase.request.method, url: requestUrl },
        assertions: [],
        error: error?.name === 'AbortError'
          ? `Request timeout sau ${testCase.request.timeoutMs ?? 15000}ms`
          : error?.message || String(error),
      });
    }
  }

  const passedTests = tests.filter(t => t.ok).length;
  const failedTests = tests.length - passedTests;

  // Phân loại failure theo Oracle type
  const specificationFailures = tests.filter(
    t => !t.ok && t.oracle?.intentType === 'SPECIFICATION',
  ).length;
  const characterizationFailures = tests.filter(
    t => !t.ok && t.oracle?.intentType === 'CHARACTERIZATION',
  ).length;

  return {
    ok: failedTests === 0,
    baseUrl: suite.baseUrl,
    startedAt,
    durationMs: Date.now() - start,
    totalTests: tests.length,
    passedTests,
    failedTests,
    specificationFailures,
    characterizationFailures,
    tests,
  };
}

// ─── Secret Redaction ────────────────────────────────────────────────────────

function redactReportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactReportValue);
  if (!value || typeof value !== 'object') return value;

  const secretNames = /authorization|cookie|set-cookie|api[-_]?key|token|password|secret/i;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      secretNames.test(key) ? '[REDACTED_SECRET]' : redactReportValue(entry),
    ]),
  );
}

// ─── Artifact Writer ─────────────────────────────────────────────────────────

export function writeApiRunArtifacts(
  result: ApiTestRunResult,
  suite: ApiTestSuite,
  runDirectory: string,
): { jsonPath: string; markdownPath: string } {
  fs.mkdirSync(runDirectory, { recursive: true });
  const safeResult = redactReportValue(result);
  const jsonPath = path.join(runDirectory, 'api-test-results.json');
  const markdownPath = path.join(runDirectory, 'api-test-results.md');

  fs.writeFileSync(jsonPath, JSON.stringify(safeResult, null, 2) + '\n');

  // Oracle Gate summary
  const gate = computeApiOracleGate(suite.tests);
  const gateIcon: Record<string, string> = {
    READY_SPECIFICATION: '🟢',
    READY_CHARACTERIZATION: '🟡',
    NEEDS_ORACLE: '🔴',
  };

  const rows = result.tests.map(test => {
    const statusIcon = test.ok ? '✅ PASS' : '❌ FAIL';
    const oracleLabel = test.oracle
      ? `${test.oracle.intentType} / ${test.oracle.authority}`
      : '⚠️ NEEDS_ORACLE';
    const failedAssertions = test.assertions.filter(a => !a.ok);
    const dbFailures = (test.dbAssertions || []).filter(d => !d.ok);
    const reason = test.error
      || [...failedAssertions.map(a => a.message), ...dbFailures.map(d => d.message)].join('; ')
      || 'OK';
    return `| ${test.id} | ${test.name} | ${statusIcon} | ${oracleLabel} | ${test.durationMs}ms | ${reason} |`;
  });

  // Specification failures need special callout
  const specFailureNotes = result.tests
    .filter(t => !t.ok && t.oracle?.intentType === 'SPECIFICATION')
    .map(t => {
      const failedAssertions = t.assertions.filter(a => !a.ok);
      const dbFails = (t.dbAssertions || []).filter(d => !d.ok);
      const allMessages = [...failedAssertions.map(a => a.message), ...dbFails.map(d => d.message)];
      return [
        `### 🔴 ${t.id}: ${t.name}`,
        `- **Endpoint**: \`${t.request.method} ${t.request.url}\``,
        `- **Oracle**: SPECIFICATION / ${t.oracle?.authority}`,
        `- **Evidence**: ${t.oracle?.evidenceSource || 'N/A'}`,
        '',
        allMessages.map(m => `> ❌ ${m}`).join('\n'),
        '',
        '> ⚠️ **Có khả năng application đang có bug — Healer không được tự sửa Oracle.**',
      ].join('\n');
    });

  const markdown = [
    '# 🧪 API Integration Test Report',
    '',
    `- **Base URL**: \`${result.baseUrl}\``,
    `- **Started**: ${result.startedAt}`,
    `- **Status**: ${result.ok ? '✅ ALL PASSED' : '❌ HAS FAILURES'}`,
    `- **Total**: ${result.totalTests} | **Passed**: ${result.passedTests} | **Failed**: ${result.failedTests}`,
    '',
    '## Oracle Gate',
    '',
    `| Gate Status | ${gateIcon[gate.gateStatus] || '⚪'} **${gate.gateStatus}** |`,
    '| --- | --- |',
    `| 🟢 Specification | ${gate.specificationCount} tests |`,
    `| 🟡 Characterization | ${gate.characterizationCount} tests |`,
    `| 🔴 Needs Oracle | ${gate.needsOracleCount} tests |`,
    '',
    '## Kết quả chi tiết',
    '',
    '| ID | Test case | Status | Oracle | Duration | Detail |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    ...(specFailureNotes.length > 0
      ? ['## ⚠️ Specification Failures (Possible Application Bugs)', '', ...specFailureNotes]
      : []),
  ].join('\n');

  fs.writeFileSync(markdownPath, markdown);
  return { jsonPath, markdownPath };
}
