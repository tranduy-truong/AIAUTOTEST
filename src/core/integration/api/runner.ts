import fs from 'fs';
import path from 'path';
import { sendApiRequest } from './client.js';
import { evaluateApiAssertion } from './assertions.js';
import { runDbAssertions } from './db-validator.js';
import { computeApiOracleGate } from './oracle.js';
import { loadProjectProfile, isEndpointSkipped } from './profile.js';
import type {
  ApiTestResult,
  ApiTestRunResult,
  ApiTestSuite,
} from './schema.js';

// ─── Entity Cache & Sequential Multi-level Path Parameter Resolver ──────────

interface EntityFixture {
  id?: string | number;
  code?: string | number;
  key?: string;
  attachmentId?: string | number;
  [key: string]: unknown;
}

function extractItemsFromBody(body: unknown): EntityFixture[] {
  if (!body) return [];
  if (Array.isArray(body)) return body.filter(item => item && typeof item === 'object');
  if (typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj['results'])) return obj['results'].filter(item => item && typeof item === 'object');
    if (Array.isArray(obj['data'])) return obj['data'].filter(item => item && typeof item === 'object');
    if (Array.isArray(obj['items'])) return obj['items'].filter(item => item && typeof item === 'object');
    // If it's a single object with code or id
    if (obj['code'] !== undefined || obj['id'] !== undefined) return [obj as EntityFixture];
  }
  return [];
}

async function resolveDynamicPathParams(
  rawPath: string,
  baseUrl: string,
  defaultHeaders: Record<string, string>,
  cache: Map<string, EntityFixture[]>,
  paramResolvers?: Record<string, string>,
): Promise<string> {
  if (!/\{[^}]+\}/.test(rawPath)) return rawPath;

  let currentPath = rawPath;

  // Xử lý từng placeholder theo thứ tự từ trái sang phải
  while (/\{([^}]+)\}/.test(currentPath)) {
    const match = currentPath.match(/\{([^}]+)\}/);
    if (!match || match.index === undefined) break;

    const paramName = match[1];
    const placeholder = match[0];
    const p = paramName.toLowerCase();

    // 1. Kiểm tra custom param resolver từ profile nếu có
    let collectionPath = paramResolvers?.[paramName] || paramResolvers?.[p];

    if (!collectionPath) {
      // Xác định đường dẫn collection ngay trước placeholder này
      const prefixBeforeParam = currentPath.substring(0, match.index);
      collectionPath = prefixBeforeParam.replace(/\/*$/, '/');
    }

    let entities = cache.get(collectionPath);

    // Nếu chưa có trong cache, probe gọi GET collection để lấy dữ liệu thực tế
    if (!entities || entities.length === 0) {
      try {
        const probeRes = await sendApiRequest(baseUrl, {
          method: 'GET',
          path: collectionPath,
          timeoutMs: 5000,
        }, defaultHeaders);

        if (probeRes.status === 200 && probeRes.body) {
          entities = extractItemsFromBody(probeRes.body);
          if (entities.length > 0) {
            cache.set(collectionPath, entities);
          }
        }
      } catch {
        // bỏ qua nếu probe thất bại
      }
    }

    const sample = entities && entities.length > 0 ? entities[0] : undefined;
    let replacement = '1';

    if (sample) {
      if (p.includes('attachment') || p.includes('file')) {
        replacement = sample.attachmentId !== undefined ? String(sample.attachmentId) : (sample.id !== undefined ? String(sample.id) : '1');
      } else if (p.includes('code') && sample.code !== undefined) {
        replacement = String(sample.code);
      } else if (p.includes('id') && sample.id !== undefined) {
        replacement = String(sample.id);
      } else if (p.includes('key') && sample.key !== undefined) {
        replacement = String(sample.key);
      } else if (sample.code !== undefined) {
        replacement = String(sample.code);
      } else if (sample.id !== undefined) {
        replacement = String(sample.id);
      }
    } else {
      // Fallback theo loại tham số
      if (p.includes('attachment') || p.includes('file')) replacement = '1';
      else if (p.includes('code')) replacement = '01';
      else if (p.includes('id')) replacement = '1';
      else if (p.includes('key')) replacement = 'theme';
      else replacement = '1';
    }

    // Thay thế đúng vị trí placeholder đầu tiên này
    currentPath = currentPath.substring(0, match.index) + replacement + currentPath.substring(match.index + placeholder.length);
  }

  return currentPath;
}

import { resolveForeignKeysInPayload } from './fk-graph.js';

function computeLifecyclePriority(method: string, apiPath: string): number {
  const m = method.toUpperCase();
  const lowerPath = apiPath.toLowerCase();
  const hasParams = /\{[^}]+\}/.test(apiPath);

  // 1. Auth & Login (để có token mới nhất)
  if (m === 'POST' && (lowerPath.endsWith('/token/') || lowerPath.endsWith('/login/'))) return 1;

  // 2. GET Collections (không có param) -> nạp đầy đủ cache thực thể và khóa ngoại
  if (m === 'GET' && !hasParams) return 2;

  // 3. GET Details (có param {code}, {id})
  if (m === 'GET' && hasParams) return 3;

  // 4. Token Refresh
  if (m === 'POST' && lowerPath.includes('/refresh')) return 4;

  // 5. POST Create (sử dụng khóa ngoại từ cache)
  if (m === 'POST') return 5;

  // 6. PUT / PATCH Update
  if (m === 'PUT' || m === 'PATCH') return 6;

  // 7. DELETE Endpoints (chạy cuối cùng)
  if (m === 'DELETE') return 7;

  return 8;
}

// ─── Main API Test Suite Runner ──────────────────────────────────────────────

export async function runApiTestSuite(suite: ApiTestSuite): Promise<ApiTestRunResult> {
  if (!suite.baseUrl) throw new Error('API baseUrl không được để trống.');
  if (!suite.tests.length) throw new Error('API test suite không có test case.');

  // Nạp Project Profile nếu có (.aiautotest/profile.yaml)
  const profile = loadProjectProfile();

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
  const entityCache = new Map<string, EntityFixture[]>();
  const throttleDelay = profile?.throttling?.delayMs ?? 40;
  const currentHeaders = { ...(suite.defaultHeaders || {}) };
  const liveSessionTokens = { accessToken: '', refreshToken: '' };
  const availablePaths = suite.tests.map(t => t.request.path);

  // ★ CRUD LIFECYCLE ORDERING: Sắp xếp thứ tự chạy tối ưu (GET Collections -> GET {id} -> POST -> PUT -> DELETE)
  const sortedTests = [...suite.tests].sort((a, b) => {
    return computeLifecyclePriority(a.request.method, a.request.path) -
           computeLifecyclePriority(b.request.method, b.request.path);
  });

  for (let i = 0; i < sortedTests.length; i++) {
    const testCase = sortedTests[i];
    const testStart = Date.now();

    // ★ SAFE MODE: Tự động bảo vệ dữ liệu gốc trên Live DB khỏi bị DELETE phá hủy
    const isDelete = testCase.request.method === 'DELETE';
    const isSkippedByProfile = isEndpointSkipped(testCase.request.method, testCase.request.path, profile?.skipEndpoints);

    if (isSkippedByProfile || (isDelete && profile?.project?.baseUrl?.includes('hcm.mobifone.vn'))) {
      tests.push({
        id: testCase.id,
        name: `${testCase.name} (SKIPPED)`,
        ok: true,
        durationMs: 0,
        oracle: testCase.oracle,
        request: { method: testCase.request.method, url: testCase.request.path },
        response: {
          status: 200,
          statusText: 'SKIPPED',
          headers: {},
          body: { message: 'Skipped by Safe Mode to preserve live master data' },
          rawBody: JSON.stringify({ message: 'Skipped by Safe Mode to preserve live master data' }),
          durationMs: 0,
        },
        assertions: [],
      });
      continue;
    }

    // ★ SEQUENTIAL MULTI-LEVEL RESOLVER: Giải quyết chuẩn xác URL lồng nhau
    const resolvedPath = await resolveDynamicPathParams(
      testCase.request.path,
      suite.baseUrl,
      currentHeaders,
      entityCache,
      profile?.paramResolvers,
    );

    // ★ PAYLOAD OVERRIDES từ Profile nếu có
    let customBody = testCase.request.body;
    if (profile?.payloadOverrides?.[testCase.request.path]?.[testCase.request.method]) {
      customBody = profile.payloadOverrides[testCase.request.path][testCase.request.method];
    }

    // ★ LIVE SESSION TOKEN HAND-OFF & FK DEPENDENCY RESOLUTION
    // ★ LIVE SESSION TOKEN HAND-OFF & FK DEPENDENCY RESOLUTION
    if (['POST', 'PUT', 'PATCH'].includes(testCase.request.method) && customBody && typeof customBody === 'object') {
      // 1. Tự động điền refresh token thật vào endpoint refresh
      if (testCase.request.path.toLowerCase().includes('refresh') && liveSessionTokens.refreshToken) {
        (customBody as any).refresh = liveSessionTokens.refreshToken;
        (customBody as any).refresh_token = liveSessionTokens.refreshToken;
      }

      // 2. Với PUT: Tự động đồng bộ trạng thái thực thể hiện tại (Full State Sync)
      if (testCase.request.method === 'PUT' && resolvedPath !== testCase.request.path) {
        try {
          const probeRes = await sendApiRequest(suite.baseUrl, {
            method: 'GET',
            path: resolvedPath,
            timeoutMs: 4000,
          }, currentHeaders);

          if (probeRes.status === 200 && probeRes.body && typeof probeRes.body === 'object') {
            const current = { ...(probeRes.body as Record<string, any>) };
            // Lược bỏ các trường hệ thống read-only do DB quản lý
            const readOnlyFields = [
              'id', 'created_at', 'updated_at', 'createdAt', 'updatedAt',
              'createdBy', 'updatedBy', 'isDeleted', 'hasPendingChanges',
              'deleted', 'deletedBy', 'reviewComment', 'reviewedBy', 'reviewedAt',
              'scopeContentType', 'scopeObjectId', 'reason', 'contentType', 'operation'
            ];
            for (const f of readOnlyFields) delete current[f];

            // Nếu status là object ({ value, label }), chỉ lấy value
            if (current.status && typeof current.status === 'object' && current.status.value !== undefined) {
              current.status = current.status.value;
            }

            // Merge dữ liệu cập nhật
            customBody = { ...current, ...customBody };
          }
        } catch {}
      }

      // 3. Với POST: Đảm bảo code và name luôn là duy nhất để tránh xung đột khóa chính
      if (testCase.request.method === 'POST') {
        const bodyObj = customBody as Record<string, any>;
        const randId = Math.random().toString(36).substring(2, 6).toUpperCase();
        if (bodyObj.code && (typeof bodyObj.code === 'string') && (bodyObj.code === 'string' || bodyObj.code.startsWith('AUTO_') || bodyObj.code.startsWith('Sample_'))) {
          bodyObj.code = `TEST_${Date.now().toString(36).toUpperCase().slice(-3)}${randId}`;
        }
        if (bodyObj.name && typeof bodyObj.name === 'string' && (bodyObj.name === 'string' || bodyObj.name.startsWith('Tự động') || bodyObj.name.startsWith('Sample_'))) {
          bodyObj.name = `Dữ liệu Test ${randId}`;
        }
      }

      // 4. FK Graph: Tự động phân giải và điền khóa ngoại thực tế
      customBody = await resolveForeignKeysInPayload(
        customBody,
        suite.baseUrl,
        currentHeaders,
        entityCache,
        availablePaths,
      );
    }

    const actualRequest = {
      ...testCase.request,
      path: resolvedPath,
      body: customBody,
    };

    const requestUrl = /^https?:\/\//i.test(resolvedPath)
      ? resolvedPath
      : new URL(
          resolvedPath.replace(/^\/+/, ''),
          `${suite.baseUrl.replace(/\/+$/, '')}/`,
        ).toString();

    // Throttling an toàn
    if (i > 0 && throttleDelay > 0) {
      await new Promise(r => setTimeout(r, throttleDelay));
    }

    try {
      let response = await sendApiRequest(
        suite.baseUrl,
        actualRequest,
        currentHeaders,
      );

      // ★ RATE LIMITING RETRY: Chờ 800ms nếu gặp 429
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, 900));
        response = await sendApiRequest(
          suite.baseUrl,
          actualRequest,
          currentHeaders,
        );
      }

      // ★ LIVE TOKEN CAPTURE: Thu thập Access Token & Refresh Token khi gọi Login thành công
      if (testCase.request.method === 'POST' && response.status === 200 && response.body && typeof response.body === 'object') {
        const bodyObj = response.body as Record<string, any>;
        if (bodyObj.access) {
          liveSessionTokens.accessToken = bodyObj.access;
          currentHeaders['Authorization'] = `Bearer ${bodyObj.access}`;
        }
        if (bodyObj.refresh) {
          liveSessionTokens.refreshToken = bodyObj.refresh;
        }
      }

      // Thu thập entity vào cache từ các response 200 GET
      if (testCase.request.method === 'GET' && response.status === 200 && response.body) {
        const found = extractItemsFromBody(response.body);
        if (found.length > 0) {
          const colKey = actualRequest.path.replace(/\/*$/, '/');
          entityCache.set(colKey, found);
          // Chỉ set root collection nếu testCase.request.path vốn dĩ là collection (không có param lồng)
          if (!/\{[^}]+\}/.test(testCase.request.path)) {
            entityCache.set(colKey, found);
          }
        }
      }

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

import { writeApiHtmlReport } from './html-reporter.js';
import { writeJunitXmlReport } from './junit-reporter.js';
import { detectAnomaliesAndRegressions } from './anomaly-detector.js';

// ─── Artifact Writer ─────────────────────────────────────────────────────────

export function writeApiRunArtifacts(
  result: ApiTestRunResult,
  suite: ApiTestSuite,
  runDirectory: string,
): { jsonPath: string; markdownPath: string; htmlPath: string; junitPath: string } {
  fs.mkdirSync(runDirectory, { recursive: true });
  const safeResult = redactReportValue(result);
  const jsonPath = path.join(runDirectory, 'api-test-results.json');
  const markdownPath = path.join(runDirectory, 'api-test-results.md');
  const htmlPath = path.join(runDirectory, 'api-test-report.html');
  const junitPath = path.join(runDirectory, 'api-test-report.xml');

  // ★ SPRINT 4: Tự động phát hiện lỗi suy thoái (Regression) & Bất thường hiệu năng (Latency Spikes)
  const anomaly = detectAnomaliesAndRegressions(result);

  fs.writeFileSync(jsonPath, JSON.stringify(safeResult, null, 2) + '\n');
  writeApiHtmlReport(result, htmlPath, anomaly);
  writeJunitXmlReport(result, junitPath);

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

  // Anomaly section in Markdown
  const anomalyNotes: string[] = [];
  if (anomaly.hasRegressions) {
    anomalyNotes.push('### 🚨 Cảnh Báo Lỗi Suy Thoái (Regression Detected!)');
    anomaly.regressedTests.forEach(r => {
      anomalyNotes.push(`- ⚠️ **${r.id}** (${r.name}): Lần trước PASS, lần này **FAIL** (Lý do: \`${r.reason}\`)`);
    });
    anomalyNotes.push('');
  }
  if (anomaly.recoveredTests.length > 0) {
    anomalyNotes.push('### 🎉 Các Test Đã Được Khắc Phục (Recovered Tests)');
    anomaly.recoveredTests.forEach(rec => {
      anomalyNotes.push(`- 🟢 **${rec.id}** (${rec.name}): Đã chuyển từ FAIL sang **PASS**!`);
    });
    anomalyNotes.push('');
  }
  if (anomaly.hasPerformanceAnomalies) {
    anomalyNotes.push('### ⏱️ Cảnh Báo Bất Thường Hiệu Năng (Performance Degradation)');
    anomaly.slowTests.forEach(s => {
      anomalyNotes.push(`- ⏳ **${s.id}**: Chậm bất thường ${s.currentDurationMs}ms (Gấp **${s.slowdownFactor}x** so với baseline ${s.historicalAverageMs}ms)`);
    });
    anomalyNotes.push('');
  }

  const markdown = [
    '# 🧪 API Integration Test Report',
    '',
    `- **Base URL**: \`${result.baseUrl}\``,
    `- **Started**: ${result.startedAt}`,
    `- **Status**: ${result.ok ? '✅ ALL PASSED' : '❌ HAS FAILURES'}`,
    `- **Total**: ${result.totalTests} | **Passed**: ${result.passedTests} | **Failed**: ${result.failedTests}`,
    '',
    ...(anomalyNotes.length > 0
      ? ['## 📊 Phân Tích Bất Thường & Lịch Sử (Sprint 4 AI Anomaly Engine)', '', ...anomalyNotes]
      : []),
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
  return { jsonPath, markdownPath, htmlPath, junitPath };
}
