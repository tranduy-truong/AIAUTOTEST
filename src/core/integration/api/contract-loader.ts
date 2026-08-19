/**
 * OpenAPI Contract Loader — Đọc spec OpenAPI 3.x JSON và sinh ApiTestSuite.
 *
 * Chỉ hỗ trợ OpenAPI JSON. Với YAML: cài js-yaml và convert trước.
 *
 * Oracle mặc định:
 * - Responses được khai báo trong spec → SPECIFICATION / REQUIREMENT
 * - Nếu response schema lấy từ source code inference → CHARACTERIZATION / IMPLEMENTATION
 */

import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import type { ApiOracle } from './oracle.js';
import { computeApiOracleGate } from './oracle.js';
import type {
  ApiTestSuite,
  ApiTestCase,
  ApiAssertion,
  ApiBodyValueType,
} from './schema.js';

// ─── OpenAPI 3.x Minimal Types ────────────────────────────────────────────────

export interface OpenApiSchemaObject {
  type?: string;
  format?: string;
  enum?: unknown[];
  default?: unknown;
  properties?: Record<string, OpenApiSchemaObject>;
  required?: string[];
  items?: OpenApiSchemaObject;
  $ref?: string;
  [key: string]: unknown;
}

export interface OpenApiMediaType {
  schema?: OpenApiSchemaObject;
}

export interface OpenApiResponse {
  description?: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: 'path' | 'query' | 'header' | 'cookie';
    required?: boolean;
    schema?: OpenApiSchemaObject;
  }>;
  requestBody?: {
    required?: boolean;
    content?: Record<string, OpenApiMediaType>;
  };
  responses?: Record<string, OpenApiResponse>;
}

export type OpenApiPathItem = Partial<Record<
  'get' | 'post' | 'put' | 'patch' | 'delete' | 'head',
  OpenApiOperation
>>;

export interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

// ─── Loader — JSON + YAML universal ─────────────────────────────────────────

/**
 * Đọc file OpenAPI 3.x — hỗ trợ cả JSON lẫn YAML.
 * Tự động phát hiện định dạng qua extension (.yaml / .yml / .json).
 * Nếu extension không rõ ràng, thử JSON trước rồi YAML.
 */
export function loadOpenApiSpec(filePath: string): OpenApiSpec {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[OpenAPI Loader] Không tìm thấy file: "${filePath}"`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();

  let spec: unknown;

  if (ext === '.yaml' || ext === '.yml') {
    spec = parseYaml(filePath, raw);
  } else if (ext === '.json') {
    spec = parseJson(filePath, raw);
  } else {
    // Extension không rõ: thử JSON trước, fallback YAML
    try {
      spec = JSON.parse(raw);
    } catch {
      spec = parseYaml(filePath, raw);
    }
  }

  validateOpenApiStructure(spec, filePath);
  return spec as OpenApiSpec;
}

function parseJson(filePath: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error: any) {
    throw new Error(
      `[OpenAPI Loader] Không thể parse JSON từ "${filePath}": ${error.message}`,
    );
  }
}

function parseYaml(filePath: string, raw: string): unknown {
  try {
    const loadFn = (yaml as any).load || (yaml as any).default?.load || yaml.load;
    return loadFn(raw);
  } catch (error: any) {
    throw new Error(
      `[OpenAPI Loader] Không thể parse YAML từ "${filePath}": ${error.message}`,
    );
  }
}

import { convertSwagger2ToOpenApi3 } from './swagger2-loader.js';
import { convertPostmanToOpenApi3 } from './postman-loader.js';
import { convertGraphQLToOpenApi3 } from './graphql-loader.js';

function validateOpenApiStructure(spec: unknown, filePath: string): void {
  if (!spec || typeof spec !== 'object') {
    throw new Error(`[OpenAPI Loader] File "${filePath}" không phải object hợp lệ.`);
  }
  const s = spec as Record<string, unknown>;

  // 1. Tự động nhận dạng nếu là GraphQL Introspection Schema
  if (s['data'] && (s['data'] as any)['__schema'] || s['__schema']) {
    const converted = convertGraphQLToOpenApi3(s);
    Object.assign(s, converted);
    return;
  }

  // 2. Tự động nhận dạng và chuyển đổi nếu là Postman Collection
  if (s['info'] && ((s['info'] as any)['_postman_id'] || (s['info'] as any)['schema']?.includes('postman')) || s['item']) {
    const converted = convertPostmanToOpenApi3(s);
    Object.assign(s, converted);
    return;
  }

  // 3. Tự động nhận dạng và chuyển đổi nếu là Swagger 2.0
  if (s['swagger'] === '2.0' || (!s['openapi'] && s['swagger'])) {
    const converted = convertSwagger2ToOpenApi3(s);
    Object.assign(s, converted);
    return;
  }

  if (!s['openapi'] || !s['paths']) {
    throw new Error(
      `[OpenAPI Loader] File "${filePath}" không đúng chuẩn OpenAPI 3.x, Swagger 2.0, Postman Collection hoặc GraphQL Introspection ` +
      '(thiếu trường "openapi", "swagger", "item" hoặc "__schema"). Kiểm tra lại file của bạn.',
    );
  }
  if (!String(s['openapi']).startsWith('3.')) {
    throw new Error(
      `[OpenAPI Loader] Chỉ hỗ trợ OpenAPI 3.x, Swagger 2.0, Postman Collection hoặc GraphQL. File đang dùng version "${s['openapi']}".`,
    );
  }
}


// ─── ID Generator ────────────────────────────────────────────────────────────

function toIdSegment(str: string): string {
  return str
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function buildTestCaseId(method: string, apiPath: string, statusCode: string): string {
  return `TC_${method.toUpperCase()}_${toIdSegment(apiPath)}_${statusCode}`;
}

// ─── Schema → ApiBodyValueType mapping ───────────────────────────────────────

const OPENAPI_TYPE_MAP: Record<string, ApiBodyValueType> = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  object: 'object',
  array: 'array',
};

function mapOpenApiType(type: string | undefined): ApiBodyValueType | null {
  if (!type) return null;
  return OPENAPI_TYPE_MAP[type] ?? null;
}

// ─── Schema → Assertions ──────────────────────────────────────────────────────

function schemaToAssertions(
  schema: OpenApiSchemaObject,
  prefix = '$',
): ApiAssertion[] {
  const assertions: ApiAssertion[] = [];
  if (!schema.properties) return assertions;

  for (const [propName, propSchema] of Object.entries(schema.properties)) {
    const propPath = `${prefix}.${propName}`;
    const mappedType = mapOpenApiType(propSchema.type);
    if (mappedType) {
      assertions.push({ type: 'BODY_PATH_TYPE', path: propPath, expected: mappedType });
    }
  }

  // Required fields → BODY_PATH_EXISTS
  for (const reqProp of (schema.required ?? [])) {
    assertions.push({ type: 'BODY_PATH_EXISTS', path: `${prefix}.${reqProp}` });
  }

  return assertions;
}

import {
  generateSmartPayload,
  findSpecializedPayload,
} from './template-registry.js';

export { generateSmartPayload, findSpecializedPayload };

// ─── Module / Domain Extractor ───────────────────────────────────────────────

export interface OpenApiModuleGroup {
  prefix: string;
  name: string;
  paths: string[];
  operationCount: number;
}

/**
 * Phân tích danh sách paths trong OpenAPI và gom nhóm thành các module nghiệp vụ trực quan.
 */
export function extractOpenApiModules(spec: OpenApiSpec): OpenApiModuleGroup[] {
  const groups = new Map<string, { paths: Set<string>; count: number; name: string }>();

  for (const [apiPath, pathItem] of Object.entries(spec.paths || {})) {
    // Trích xuất base resource segment, ví dụ "/dema/api/religions/{code}/" -> "/dema/api/religions"
    const segments = apiPath.split('/').filter(Boolean);
    let prefix = apiPath;
    let name = apiPath;

    if (segments.length >= 3) {
      // ví dụ: ["dema", "api", "religions"] -> "/dema/api/religions"
      prefix = '/' + segments.slice(0, 3).join('/');
      name = segments[2].replace(/[-_]+/g, ' ').toUpperCase();
    } else if (segments.length >= 2) {
      prefix = '/' + segments.slice(0, 2).join('/');
      name = segments[1].replace(/[-_]+/g, ' ').toUpperCase();
    }

    if (!groups.has(prefix)) {
      groups.set(prefix, { paths: new Set(), count: 0, name });
    }

    const grp = groups.get(prefix)!;
    grp.paths.add(apiPath);

    const methods = ['get', 'post', 'put', 'patch', 'delete', 'head'] as const;
    for (const m of methods) {
      if (pathItem[m]) grp.count++;
    }
  }

  return Array.from(groups.entries()).map(([prefix, info]) => ({
    prefix,
    name: info.name,
    paths: Array.from(info.paths),
    operationCount: info.count,
  }));
}

// ─── Suite Generator ──────────────────────────────────────────────────────────

export interface GenerateOptions {
  /** Chỉ sinh test cho các path này. undefined = tất cả paths. */
  onlyPaths?: string[];
  /** Override base URL (mặc định lấy từ spec.servers[0].url nếu có). */
  baseUrl?: string;
}

export function generateApiTestSuiteFromOpenApi(
  spec: OpenApiSpec,
  baseUrl: string,
  options: GenerateOptions = {},
): ApiTestSuite {
  const tests: ApiTestCase[] = [];
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head'] as const;

  for (const [apiPath, pathItem] of Object.entries(spec.paths)) {
    if (options.onlyPaths && !options.onlyPaths.includes(apiPath)) continue;

    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation?.responses) continue;

      for (const [statusCode, response] of Object.entries(operation.responses)) {
        const statusNum = parseInt(statusCode, 10);
        if (isNaN(statusNum)) continue; // bỏ qua 'default'

        const id = buildTestCaseId(method, apiPath, statusCode);
        const evidenceSource = `OpenAPI ${spec.openapi} — ${method.toUpperCase()} ${apiPath} → HTTP ${statusCode}`;

        const oracle: ApiOracle = {
          intentType: 'SPECIFICATION',
          authority: 'REQUIREMENT',
          evidenceSource,
        };

        const assertions: ApiAssertion[] = [
          { type: 'STATUS', expected: statusNum },
        ];

        // Chỉ khai báo body assertions cho 2xx responses
        if (statusNum >= 200 && statusNum < 300) {
          const jsonContent = response.content?.['application/json'];
          if (jsonContent?.schema) {
            assertions.push(...schemaToAssertions(jsonContent.schema));
          }
        }

        // Tạo realistic payload cho POST/PUT/PATCH nếu có requestBody hoặc endpoint đặc thù
        let requestBodyPayload: unknown = undefined;
        let requestBodyType: ApiTestCase['request']['bodyType'] = undefined;

        if (['post', 'put', 'patch'].includes(method)) {
          const reqJson = operation.requestBody?.content?.['application/json'];
          const schema = reqJson?.schema;

          // 1. Kiểm tra template đặc thù (token, refresh, upload-url, password)
          const specialized = findSpecializedPayload({
            method,
            path: apiPath,
            schema,
          });

          if (specialized) {
            requestBodyPayload = specialized;
            requestBodyType = 'json';
          } else if (schema) {
            // 2. Tự động sinh smart payload từ schema (format, enum, required, min/max)
            requestBodyPayload = generateSmartPayload(schema);
            requestBodyType = 'json';
          }
        }

        tests.push({
          id,
          name: operation.summary
            ? `${operation.summary} → HTTP ${statusCode}`
            : `${method.toUpperCase()} ${apiPath} → HTTP ${statusCode}`,
          request: {
            method: method.toUpperCase() as ApiTestCase['request']['method'],
            path: apiPath,
            body: requestBodyPayload,
            bodyType: requestBodyType,
          },
          assertions,
          oracle,
        });
      }
    }
  }


  return {
    version: 1,
    baseUrl,
    tests,
  };
}

// ─── Artifact Writer ──────────────────────────────────────────────────────────

export function writeApiTestSuiteArtifact(
  suite: ApiTestSuite,
  outputPath = path.join(process.cwd(), 'artifacts', 'api-test-plan.json'),
): string {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(suite, null, 2) + '\n');
  return outputPath;
}

// ─── Markdown Renderer ────────────────────────────────────────────────────────

export function renderApiTestPlanMarkdown(suite: ApiTestSuite): string {
  const gate = computeApiOracleGate(suite.tests);

  const gateIcon: Record<string, string> = {
    READY_SPECIFICATION: '🟢',
    READY_CHARACTERIZATION: '🟡',
    NEEDS_ORACLE: '🔴',
  };

  const lines: string[] = [
    `# 📋 API Test Plan`,
    '',
    `- **Base URL**: \`${suite.baseUrl}\``,
    `- **Total Test Cases**: ${suite.tests.length}`,
    '',
    '## Oracle Gate',
    '',
    `| Gate Status | ${gateIcon[gate.gateStatus] ?? '⚪'} **${gate.gateStatus}** |`,
    '| --- | --- |',
    `| 🟢 Specification | ${gate.specificationCount} |`,
    `| 🟡 Characterization | ${gate.characterizationCount} |`,
    `| 🔴 Needs Oracle | ${gate.needsOracleCount} |`,
    '',
    '## Test Cases',
    '',
    '| ID | Name | Method | Path | HTTP | Oracle |',
    '| --- | --- | --- | --- | --- | --- |',
    ...suite.tests.map(tc => {
      const statusAssertion = tc.assertions.find(a => a.type === 'STATUS');
      const statusCode = statusAssertion && 'expected' in statusAssertion ? String(statusAssertion.expected) : '?';
      const oracleLabel = tc.oracle ? `${tc.oracle.intentType}` : '⚠️ MISSING';
      return `| ${tc.id} | ${tc.name} | ${tc.request.method} | \`${tc.request.path}\` | ${statusCode} | ${oracleLabel} |`;
    }),
  ];

  if (gate.needsOracleCount > 0) {
    lines.push('', '> ⚠️ Còn test case chưa có oracle. Tester cần xem xét và xác nhận expected values trước khi chạy.');
  }

  return lines.join('\n') + '\n';
}

// ─── Vitest Code Generator ───────────────────────────────────────────────────

export function generateVitestCodeFromApiTestSuite(suite: ApiTestSuite): string {
  const testBlocks = suite.tests.map(tc => {
    const statusAssertion = tc.assertions.find(a => a.type === 'STATUS');
    const statusCode = statusAssertion && 'expected' in statusAssertion ? statusAssertion.expected : 200;
    const pathWithParams = tc.request.path.replace(/\{([^}]+)\}/g, '1');

    return `  it('${tc.id}: ${tc.name.replace(/'/g, "\\'")}', async () => {
    const url = \`\${baseUrl}${pathWithParams}\`;
    const options: RequestInit = {
      method: '${tc.request.method}',
      headers: getHeaders(),
    };
    ${tc.request.method !== 'GET' && tc.request.method !== 'HEAD' ? "options.body = JSON.stringify({});" : ""}
    const res = await fetch(url, options);
    expect(res.status).toBe(${statusCode});
  });`;
  });

  return `/**
 * AUTO-GENERATED API INTEGRATION TEST SUITE
 * Base URL: ${suite.baseUrl}
 * Generated: ${new Date().toISOString()}
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function getWizardConfig() {
  const wizardConfigPath = path.join(process.cwd(), 'artifacts', '.api-wizard-last.json');
  if (fs.existsSync(wizardConfigPath)) {
    try {
      return JSON.parse(fs.readFileSync(wizardConfigPath, 'utf-8'));
    } catch {}
  }
  return null;
}

const config = getWizardConfig();
const baseUrl = (process.env.API_BASE_URL || config?.baseUrl || '${suite.baseUrl}').replace(/\\/+$/, '');

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
  const token = process.env.API_BEARER_TOKEN || config?.auth?.bearerToken;
  if (token) {
    headers['Authorization'] = \`Bearer \${token.replace(/^Bearer\\s+/i, '')}\`;
  }
  return headers;
}

describe('OpenAPI Integration Tests', () => {
${testBlocks.join('\n\n')}
});
`;
}
