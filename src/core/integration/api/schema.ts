import type { ApiSecurityConfig } from './security.js';
import type { ApiOracle } from './oracle.js';

export type ApiHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export type ApiBodyType = 'json' | 'text' | 'empty';

export interface ApiRequestDefinition {
  method: ApiHttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  bodyType?: ApiBodyType;
  timeoutMs?: number;
}

export type ApiBodyValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null';

export type ApiAssertion =
  | { type: 'STATUS'; expected: number }
  | { type: 'STATUS_IN'; expected: number[] }
  | { type: 'HEADER_EXISTS'; name: string }
  | { type: 'HEADER_EQUALS'; name: string; expected: string }
  | { type: 'BODY_PATH_EXISTS'; path: string }
  | { type: 'BODY_PATH_EQUALS'; path: string; expected: unknown }
  | { type: 'BODY_PATH_TYPE'; path: string; expected: ApiBodyValueType }
  | { type: 'BODY_CONTAINS'; expected: string };

// ─── DB Assertion — kiểm tra trạng thái database sau API call ────────────────

export interface ApiDbAssertion {
  /**
   * Câu SQL SELECT để truy vấn. Chỉ SELECT được phép.
   * Ví dụ: "SELECT total FROM carts WHERE user_id = 999"
   */
  query: string;
  /**
   * Số dòng mong đợi trả về. undefined = không kiểm tra row count.
   */
  expectedRowCount?: number;
  /**
   * Giá trị mong đợi tại row đầu tiên (index 0).
   * Key = tên cột (lowercase), Value = giá trị so sánh.
   * Ví dụ: { total: 90000 }
   */
  expectedFirstRow?: Record<string, unknown>;
  /** Mô tả ngắn gọn mục đích assertion. */
  description?: string;
}

export interface ApiDbAssertionResult {
  description: string;
  query: string;
  ok: boolean;
  message: string;
  actualRowCount?: number;
  actualFirstRow?: Record<string, unknown>;
}

// ─── Test Case ───────────────────────────────────────────────────────────────

export interface ApiTestCase {
  id: string;
  name: string;
  request: ApiRequestDefinition;
  assertions: ApiAssertion[];
  /**
   * Oracle: nguồn gốc và authority của expected values trong test case này.
   * Nếu undefined → gateStatus = NEEDS_ORACLE.
   * AI không được tự suy ra oracle từ source code.
   */
  oracle?: ApiOracle;
  /**
   * Kiểm tra trạng thái database SAU khi HTTP call hoàn thành.
   * Chỉ hỗ trợ SELECT. Yêu cầu databaseUrl trong sandbox context.
   */
  dbAssertions?: ApiDbAssertion[];
}

export interface ApiTestSuite {
  version: 1;
  baseUrl: string;
  security?: ApiSecurityConfig;
  defaultHeaders?: Record<string, string>;
  /**
   * URL của database test (SQLite file path hoặc postgresql://...).
   * Bắt buộc nếu bất kỳ test case nào có dbAssertions.
   */
  databaseUrl?: string;
  tests: ApiTestCase[];
}

// ─── Response & Assertion Results ────────────────────────────────────────────

export interface ApiResponseSnapshot {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string;
  durationMs: number;
}

export interface ApiAssertionResult {
  type: ApiAssertion['type'];
  ok: boolean;
  message: string;
}

export interface ApiTestResult {
  id: string;
  name: string;
  ok: boolean;
  durationMs: number;
  oracle?: ApiOracle;
  request: {
    method: ApiHttpMethod;
    url: string;
  };
  response?: ApiResponseSnapshot;
  assertions: ApiAssertionResult[];
  dbAssertions?: ApiDbAssertionResult[];
  error?: string;
}

export interface ApiTestRunResult {
  ok: boolean;
  baseUrl: string;
  startedAt: string;
  durationMs: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  /** Số test SPECIFICATION bị fail → có thể là application bug. */
  specificationFailures: number;
  /** Số test CHARACTERIZATION bị fail → có thể là code thay đổi. */
  characterizationFailures: number;
  tests: ApiTestResult[];
}
