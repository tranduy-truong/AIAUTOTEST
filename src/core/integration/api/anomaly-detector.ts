/**
 * Anomaly & Performance Regression Detector for API Contract Testing
 *
 * Tự động lưu lịch sử các lần chạy kiểm thử và phát hiện:
 * 1. Test bị suy thoái (Regression): Lần trước PASS, lần này đột ngột FAIL.
 * 2. Test được khắc phục (Recovered): Lần trước FAIL, lần này đã PASS.
 * 3. Bất thường hiệu năng (Latency Anomaly): Thời gian phản hồi tăng đột biến (>200% so với trung bình lịch sử).
 */

import fs from 'fs';
import path from 'path';
import type { ApiTestRunResult, ApiTestResult } from './schema.js';

export interface HistoricalRunRecord {
  startedAt: string;
  baseUrl: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  durationMs: number;
  tests: Array<{
    id: string;
    ok: boolean;
    durationMs: number;
    status?: number;
  }>;
}

export interface AnomalyReport {
  hasRegressions: boolean;
  hasPerformanceAnomalies: boolean;
  regressedTests: Array<{
    id: string;
    name: string;
    previousStatus: 'PASS';
    currentStatus: 'FAIL';
    reason: string;
  }>;
  recoveredTests: Array<{
    id: string;
    name: string;
  }>;
  slowTests: Array<{
    id: string;
    name: string;
    currentDurationMs: number;
    historicalAverageMs: number;
    slowdownFactor: number;
  }>;
}

const HISTORY_FILE = path.join(process.cwd(), 'artifacts', 'history', 'api-runs-history.json');
const MAX_HISTORY_RUNS = 30;

export function loadRunHistory(): HistoricalRunRecord[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export function saveRunToHistory(result: ApiTestRunResult): void {
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const history = loadRunHistory();
    const newRecord: HistoricalRunRecord = {
      startedAt: result.startedAt,
      baseUrl: result.baseUrl,
      totalTests: result.totalTests,
      passedTests: result.passedTests,
      failedTests: result.failedTests,
      durationMs: result.durationMs,
      tests: result.tests.map(t => ({
        id: t.id,
        ok: t.ok,
        durationMs: t.durationMs,
        status: t.response?.status,
      })),
    };

    history.push(newRecord);
    if (history.length > MAX_HISTORY_RUNS) {
      history.shift();
    }

    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch {}
}

export function detectAnomaliesAndRegressions(currentResult: ApiTestRunResult): AnomalyReport {
  const history = loadRunHistory();
  const lastRun = history.length > 0 ? history[history.length - 1] : null;

  const regressedTests: AnomalyReport['regressedTests'] = [];
  const recoveredTests: AnomalyReport['recoveredTests'] = [];
  const slowTests: AnomalyReport['slowTests'] = [];

  // Bản đồ kết quả lần trước
  const lastRunMap = new Map<string, { ok: boolean; durationMs: number }>();
  if (lastRun) {
    for (const t of lastRun.tests) {
      lastRunMap.set(t.id, { ok: t.ok, durationMs: t.durationMs });
    }
  }

  // Tính trung bình thời gian thực thi lịch sử của từng test case
  const avgDurationMap = new Map<string, number>();
  if (history.length >= 2) {
    for (const test of currentResult.tests) {
      const pastDurations: number[] = [];
      for (const run of history) {
        const found = run.tests.find(pt => pt.id === test.id);
        if (found && found.durationMs > 0) {
          pastDurations.push(found.durationMs);
        }
      }
      if (pastDurations.length > 0) {
        const avg = pastDurations.reduce((sum, d) => sum + d, 0) / pastDurations.length;
        avgDurationMap.set(test.id, avg);
      }
    }
  }

  // Phát hiện Regression & Recovered
  for (const currentTest of currentResult.tests) {
    const prev = lastRunMap.get(currentTest.id);

    if (prev) {
      // 1. Suy thoái: Lần trước PASS, lần này FAIL
      if (prev.ok && !currentTest.ok) {
        const reason = currentTest.error
          || currentTest.assertions.find(a => !a.ok)?.message
          || 'Bị lỗi không rõ nguyên nhân';
        regressedTests.push({
          id: currentTest.id,
          name: currentTest.name,
          previousStatus: 'PASS',
          currentStatus: 'FAIL',
          reason,
        });
      }

      // 2. Khắc phục: Lần trước FAIL, lần này PASS
      if (!prev.ok && currentTest.ok) {
        recoveredTests.push({
          id: currentTest.id,
          name: currentTest.name,
        });
      }
    }

    // 3. Bất thường hiệu năng (Latency Spike > 2.5x so với baseline và > 300ms)
    const histAvg = avgDurationMap.get(currentTest.id);
    if (histAvg && histAvg > 0 && currentTest.durationMs > 300) {
      const factor = currentTest.durationMs / histAvg;
      if (factor >= 2.5) {
        slowTests.push({
          id: currentTest.id,
          name: currentTest.name,
          currentDurationMs: currentTest.durationMs,
          historicalAverageMs: Math.round(histAvg),
          slowdownFactor: Math.round(factor * 10) / 10,
        });
      }
    }
  }

  // Sau khi phân tích xong, ghi đợt chạy hiện tại vào lịch sử
  saveRunToHistory(currentResult);

  return {
    hasRegressions: regressedTests.length > 0,
    hasPerformanceAnomalies: slowTests.length > 0,
    regressedTests,
    recoveredTests,
    slowTests,
  };
}
