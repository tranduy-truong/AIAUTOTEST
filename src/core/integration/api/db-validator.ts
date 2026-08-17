/**
 * DB Validator — kiểm tra trạng thái database sau API call.
 *
 * Hỗ trợ:
 * - SQLite (file path hoặc sqlite:// URI) — không cần Docker.
 * - PostgreSQL (postgresql:// URI) — cần pg driver cài đặt trong project target.
 *
 * ⚠️ Chỉ cho phép câu SELECT. INSERT/UPDATE/DELETE sẽ bị từ chối ngay lập tức.
 */

import type { ApiDbAssertion, ApiDbAssertionResult } from './schema.js';

// ─── Query Sanitizer ─────────────────────────────────────────────────────────

const SELECT_ONLY = /^\s*SELECT\b/i;
const DANGEROUS_PATTERNS = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|EXEC|EXECUTE|GRANT|REVOKE)\b/i;

function assertSelectOnly(query: string): void {
  if (!SELECT_ONLY.test(query)) {
    throw new Error(`[DB Validator] Chỉ cho phép câu SELECT. Query bị từ chối: "${query.slice(0, 80)}"`);
  }
  if (DANGEROUS_PATTERNS.test(query)) {
    throw new Error(`[DB Validator] Phát hiện câu lệnh nguy hiểm trong query: "${query.slice(0, 80)}"`);
  }
}

// ─── Row normalization ────────────────────────────────────────────────────────

function normalizeRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return {};
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── SQLite Executor ─────────────────────────────────────────────────────────

async function executeSqlite(
  databaseUrl: string,
  query: string,
): Promise<Record<string, unknown>[]> {
  const dbPath = databaseUrl.replace(/^sqlite:\/\/\/?/i, '');

  // Thử dùng better-sqlite3 nếu có (dùng variable để tránh Vite static analysis)
  const moduleName = 'better-sqlite3';
  try {
    const BetterSqlite3 = await import(/* @vite-ignore */ moduleName);
    const Ctor = (BetterSqlite3 as any).default ?? BetterSqlite3;
    const db = new Ctor(dbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = (db.prepare(query).all() as Record<string, unknown>[]);
      return rows.map(normalizeRow);
    } finally {
      db.close();
    }
  } catch {
    throw new Error(
      `[DB Validator] Không thể kết nối SQLite tại "${dbPath}". ` +
      'Cài better-sqlite3 hoặc kiểm tra lại đường dẫn file.',
    );
  }
}

// ─── PostgreSQL Executor ──────────────────────────────────────────────────────

async function executePostgres(
  databaseUrl: string,
  query: string,
): Promise<Record<string, unknown>[]> {
  const pgModule = 'pg';
  try {
    const pg = await import(/* @vite-ignore */ pgModule);
    const Client = (pg as any).Client ?? (pg as any).default?.Client;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const result = await client.query(query);
      return ((result.rows as Record<string, unknown>[])).map(normalizeRow);
    } finally {
      await client.end();
    }
  } catch (error: any) {
    if (/cannot find module|err_module_not_found/i.test(error.message || '')) {
      throw new Error(
        '[DB Validator] Driver "pg" chưa được cài. Chạy: npm install pg --save-dev',
      );
    }
    throw error;
  }
}

// ─── Universal Executor ───────────────────────────────────────────────────────

async function executeQuery(
  databaseUrl: string,
  query: string,
): Promise<Record<string, unknown>[]> {
  assertSelectOnly(query);

  const url = databaseUrl.toLowerCase();
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) {
    return executePostgres(databaseUrl, query);
  }
  // SQLite: file path hoặc sqlite://... URI
  return executeSqlite(databaseUrl, query);
}

// ─── Assertion Runner ─────────────────────────────────────────────────────────

export async function runDbAssertions(
  databaseUrl: string,
  assertions: ApiDbAssertion[],
): Promise<ApiDbAssertionResult[]> {
  const results: ApiDbAssertionResult[] = [];

  for (const assertion of assertions) {
    const description = assertion.description || assertion.query.slice(0, 60);

    try {
      const rows = await executeQuery(databaseUrl, assertion.query);
      const issues: string[] = [];

      // Kiểm tra row count nếu có yêu cầu
      if (assertion.expectedRowCount !== undefined) {
        if (rows.length !== assertion.expectedRowCount) {
          issues.push(
            `Row count sai: expected ${assertion.expectedRowCount}, actual ${rows.length}`,
          );
        }
      }

      // Kiểm tra first row nếu có yêu cầu
      if (assertion.expectedFirstRow !== undefined) {
        if (rows.length === 0) {
          issues.push('Không có dòng nào được trả về, không thể kiểm tra first row.');
        } else {
          const firstRow = rows[0];
          for (const [column, expectedValue] of Object.entries(assertion.expectedFirstRow)) {
            const colKey = column.toLowerCase();
            if (!(colKey in firstRow)) {
              issues.push(`Cột "${column}" không tồn tại trong kết quả.`);
            } else if (!deepEqual(firstRow[colKey], expectedValue)) {
              issues.push(
                `Cột "${column}" sai: expected ${JSON.stringify(expectedValue)}, actual ${JSON.stringify(firstRow[colKey])}`,
              );
            }
          }
        }
      }

      results.push({
        description,
        query: assertion.query,
        ok: issues.length === 0,
        message: issues.length === 0
          ? `DB assertion OK${assertion.expectedRowCount !== undefined ? ` (${rows.length} rows)` : ''}`
          : issues.join('; '),
        actualRowCount: rows.length,
        actualFirstRow: rows[0],
      });
    } catch (error: any) {
      results.push({
        description,
        query: assertion.query,
        ok: false,
        message: `DB assertion error: ${error?.message || String(error)}`,
      });
    }
  }

  return results;
}
