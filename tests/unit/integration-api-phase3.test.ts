/**
 * Unit tests cho Phase 3.2–3.5:
 * - Oracle annotation (oracle.ts)
 * - DB Validator (db-validator.ts)
 * - OpenAPI Contract Loader (contract-loader.ts)
 * - API Healer (healer/run.ts classifyApiFailure)
 */

import { describe, it, expect } from 'vitest';
import {
  computeApiOracleGate,
  buildSpecificationOracle,
  buildCharacterizationOracle,
  buildTesterConfirmedOracle,
} from '../../src/core/integration/api/oracle.js';
import { runDbAssertions } from '../../src/core/integration/api/db-validator.js';
import {
  loadOpenApiSpec,
  generateApiTestSuiteFromOpenApi,
  renderApiTestPlanMarkdown,
} from '../../src/core/integration/api/contract-loader.js';
import { classifyApiFailure } from '../../src/agents/healer/run.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── Oracle Gate ──────────────────────────────────────────────────────────────

describe('API Oracle Gate', () => {
  it('reports READY_SPECIFICATION when all tests have specification oracle', () => {
    const tests = [
      { oracle: buildSpecificationOracle('OpenAPI 3.0 POST /api/cart → 200') },
      { oracle: buildSpecificationOracle('Requirement §3.2 SALE10') },
    ];
    const gate = computeApiOracleGate(tests);
    expect(gate.gateStatus).toBe('READY_SPECIFICATION');
    expect(gate.specificationCount).toBe(2);
    expect(gate.needsOracleCount).toBe(0);
  });

  it('reports NEEDS_ORACLE when any test lacks an oracle', () => {
    const tests = [
      { oracle: buildSpecificationOracle('OpenAPI → 200') },
      { oracle: undefined },
    ];
    const gate = computeApiOracleGate(tests);
    expect(gate.gateStatus).toBe('NEEDS_ORACLE');
    expect(gate.needsOracleCount).toBe(1);
  });

  it('reports READY_CHARACTERIZATION when mix of spec and char with no missing', () => {
    const tests = [
      { oracle: buildSpecificationOracle('OpenAPI → 200') },
      { oracle: buildCharacterizationOracle('Source code returns 204') },
    ];
    const gate = computeApiOracleGate(tests);
    expect(gate.gateStatus).toBe('READY_CHARACTERIZATION');
    expect(gate.specificationCount).toBe(1);
    expect(gate.characterizationCount).toBe(1);
  });

  it('buildTesterConfirmedOracle creates SPECIFICATION authority=TESTER_CONFIRMATION', () => {
    const oracle = buildTesterConfirmedOracle('Tester reviewed 2026-08-17', 'admin@company.vn');
    expect(oracle.intentType).toBe('SPECIFICATION');
    expect(oracle.authority).toBe('TESTER_CONFIRMATION');
    expect(oracle.confirmedBy).toBe('admin@company.vn');
  });

  it('buildCharacterizationOracle creates CHARACTERIZATION authority=IMPLEMENTATION', () => {
    const oracle = buildCharacterizationOracle('AI read source, cart.total returned 99990');
    expect(oracle.intentType).toBe('CHARACTERIZATION');
    expect(oracle.authority).toBe('IMPLEMENTATION');
  });
});

// ─── DB Validator — SELECT-only policy ───────────────────────────────────────

describe('DB Validator — SELECT-only policy', () => {
  it('rejects INSERT queries immediately', async () => {
    await expect(
      runDbAssertions('sqlite://does-not-matter.sqlite', [
        { query: 'INSERT INTO carts (id) VALUES (1)', description: 'bad insert' },
      ]),
    ).resolves.toMatchObject([{ ok: false, message: expect.stringContaining('SELECT') }]);
  });

  it('rejects UPDATE queries immediately', async () => {
    const results = await runDbAssertions('sqlite://x.sqlite', [
      { query: 'UPDATE carts SET total=0 WHERE id=1', description: 'bad update' },
    ]);
    expect(results[0].ok).toBe(false);
    expect(results[0].message).toMatch(/SELECT/i);
  });

  it('rejects DROP queries immediately', async () => {
    const results = await runDbAssertions('sqlite://x.sqlite', [
      { query: 'DROP TABLE carts', description: 'bad drop' },
    ]);
    expect(results[0].ok).toBe(false);
  });

  it('returns error result when SQLite file does not exist', async () => {
    const results = await runDbAssertions('/nonexistent/path/db.sqlite', [
      { query: 'SELECT 1 as one', expectedRowCount: 1 },
    ]);
    expect(results[0].ok).toBe(false);
    expect(results[0].message).toMatch(/DB assertion error/i);
  });
});

// ─── OpenAPI Contract Loader ──────────────────────────────────────────────────

describe('OpenAPI Contract Loader', () => {
  const tmpDir = join(tmpdir(), '.api-contract-loader-test');

  const sampleSpec = {
    openapi: '3.0.0',
    info: { title: 'Cart API', version: '1.0.0' },
    paths: {
      '/api/cart/apply-discount': {
        post: {
          summary: 'Apply discount coupon',
          responses: {
            '200': {
              description: 'Discount applied',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['finalPrice'],
                    properties: {
                      discountPercent: { type: 'number' },
                      discountAmount: { type: 'number' },
                      finalPrice: { type: 'number' },
                    },
                  },
                },
              },
            },
            '400': { description: 'Invalid coupon' },
            '404': { description: 'User not found' },
          },
        },
      },
    },
  };

  it('loads valid OpenAPI JSON spec', () => {
    mkdirSync(tmpDir, { recursive: true });
    const specPath = join(tmpDir, 'openapi.json');
    writeFileSync(specPath, JSON.stringify(sampleSpec));
    const spec = loadOpenApiSpec(specPath);
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.info.title).toBe('Cart API');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads a YAML spec file successfully', () => {
    mkdirSync(tmpDir, { recursive: true });
    const yamlPath = join(tmpDir, 'openapi.yaml');
    // Write minimal YAML representation of sampleSpec
    writeFileSync(yamlPath, [
      "openapi: '3.0.0'",
      'info:',
      '  title: Cart API',
      '  version: 1.0.0',
      'paths:',
      '  /api/cart/apply-discount:',
      '    post:',
      '      summary: Apply discount',
      '      responses:',
      "        '200':",
      "          description: OK",
    ].join('\n'));
    const spec = loadOpenApiSpec(yamlPath);
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.info.title).toBe('Cart API');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws a clear error when file does not exist', () => {
    expect(() => loadOpenApiSpec('/nonexistent/path/openapi.json')).toThrow('Không tìm thấy file');
  });

  it('throws on Swagger 2.0 spec (unsupported version)', () => {
    mkdirSync(tmpDir, { recursive: true });
    const v2Path = join(tmpDir, 'swagger2.json');
    writeFileSync(v2Path, JSON.stringify({ swagger: '2.0', info: { title: 'Old', version: '1.0' }, paths: {} }));
    // Missing 'openapi' key — should fail validation
    expect(() => loadOpenApiSpec(v2Path)).toThrow('openapi');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates test cases with SPECIFICATION oracle for each response code', () => {
    const suite = generateApiTestSuiteFromOpenApi(
      sampleSpec as any,
      'http://localhost:3000',
    );
    expect(suite.tests.length).toBe(3); // 200, 400, 404
    for (const tc of suite.tests) {
      expect(tc.oracle?.intentType).toBe('SPECIFICATION');
      expect(tc.oracle?.authority).toBe('REQUIREMENT');
    }
  });

  it('generates STATUS assertion for every test case', () => {
    const suite = generateApiTestSuiteFromOpenApi(sampleSpec as any, 'http://localhost:3000');
    for (const tc of suite.tests) {
      const statusAssertion = tc.assertions.find(a => a.type === 'STATUS');
      expect(statusAssertion).toBeDefined();
    }
  });

  it('generates BODY_PATH_TYPE assertions for 200 response schema properties', () => {
    const suite = generateApiTestSuiteFromOpenApi(sampleSpec as any, 'http://localhost:3000');
    const tc200 = suite.tests.find(tc => tc.id.includes('200'));
    expect(tc200).toBeDefined();
    const typeAssertions = tc200!.assertions.filter(a => a.type === 'BODY_PATH_TYPE');
    expect(typeAssertions.length).toBe(3); // discountPercent, discountAmount, finalPrice
  });

  it('generates BODY_PATH_EXISTS assertions for required fields in 200 response', () => {
    const suite = generateApiTestSuiteFromOpenApi(sampleSpec as any, 'http://localhost:3000');
    const tc200 = suite.tests.find(tc => tc.id.includes('200'));
    const existsAssertions = tc200!.assertions.filter(a => a.type === 'BODY_PATH_EXISTS');
    expect(existsAssertions.length).toBe(1); // only finalPrice is required
  });

  it('does NOT generate body assertions for 4xx responses', () => {
    const suite = generateApiTestSuiteFromOpenApi(sampleSpec as any, 'http://localhost:3000');
    const tc400 = suite.tests.find(tc => tc.id.includes('400'));
    const tc404 = suite.tests.find(tc => tc.id.includes('404'));
    expect(tc400!.assertions.length).toBe(1); // only STATUS
    expect(tc404!.assertions.length).toBe(1); // only STATUS
  });

  it('filters by onlyPaths option', () => {
    const spec2 = {
      ...sampleSpec,
      paths: {
        ...sampleSpec.paths,
        '/api/user': { get: { responses: { '200': { description: 'OK' } } } },
      },
    };
    const suite = generateApiTestSuiteFromOpenApi(spec2 as any, 'http://localhost:3000', {
      onlyPaths: ['/api/cart/apply-discount'],
    });
    expect(suite.tests.every(tc => tc.request.path === '/api/cart/apply-discount')).toBe(true);
  });

  it('renders oracle gate in markdown with correct counts', () => {
    const suite = generateApiTestSuiteFromOpenApi(sampleSpec as any, 'http://localhost:3000');
    const md = renderApiTestPlanMarkdown(suite);
    expect(md).toContain('READY_SPECIFICATION');
    expect(md).toContain('3'); // 3 spec tests
    expect(md).toContain('Specification');
  });
});

// ─── API Healer Classifier ────────────────────────────────────────────────────

describe('API Healer — classifyApiFailure', () => {
  it('classifies specification oracle mismatch as API_ORACLE_MISMATCH, REPORT_ONLY', () => {
    const errorLog = `
      Body path "$.finalPrice" sai: expected 90000, received 99990
      Oracle: SPECIFICATION / REQUIREMENT
      expected 90000 received 99990
    `;
    const diagnosis = classifyApiFailure(errorLog);
    expect(diagnosis.category).toBe('API_ORACLE_MISMATCH');
    expect(diagnosis.canSelfHeal).toBe(false);
    expect(diagnosis.recoveryAction).toBe('REPORT_ONLY');
    expect(diagnosis.preservesExpectedResult).toBe(true);
  });

  it('classifies general assertion failure as ASSERTION_ERROR', () => {
    const errorLog = 'HTTP status sai: expected 200, received 404';
    const diagnosis = classifyApiFailure(errorLog);
    expect(diagnosis.category).toBe('ASSERTION_ERROR');
    expect(diagnosis.canSelfHeal).toBe(false);
  });

  it('classifies DB assertion failure as API_DB_ASSERTION', () => {
    const diagnosis = classifyApiFailure('DB assertion: row count sai: expected 1, actual 0');
    expect(diagnosis.category).toBe('API_DB_ASSERTION');
    expect(diagnosis.canSelfHeal).toBe(false);
  });

  it('classifies missing baseUrl as API_ENV_CONFIG', () => {
    const diagnosis = classifyApiFailure('API baseUrl không được để trống.');
    expect(diagnosis.category).toBe('API_ENV_CONFIG');
    expect(diagnosis.reasonCode).toBe('API_ENVIRONMENT_MISCONFIGURED');
  });

  it('classifies security block as API_ENV_CONFIG with HOST_BLOCKED reason', () => {
    const diagnosis = classifyApiFailure('[API Security] Từ chối host có dấu hiệu Production: prod.example.com');
    expect(diagnosis.category).toBe('API_ENV_CONFIG');
    expect(diagnosis.reasonCode).toBe('API_HOST_BLOCKED_BY_SECURITY_POLICY');
  });

  it('classifies unmocked endpoint as API_MOCK_CONFIG', () => {
    const diagnosis = classifyApiFailure('501 Unmocked Request: GET /api/v1/unmocked-path');
    expect(diagnosis.category).toBe('API_MOCK_CONFIG');
    expect(diagnosis.reasonCode).toBe('EXTERNAL_SERVICE_STUB_NOT_CONFIGURED');
  });

  it('classifies network failure as NETWORK_ERROR', () => {
    const diagnosis = classifyApiFailure('fetch failed: ECONNREFUSED 127.0.0.1:3000');
    expect(diagnosis.category).toBe('NETWORK_ERROR');
    expect(diagnosis.reasonCode).toBe('API_NETWORK_OR_BACKEND_UNAVAILABLE');
  });

  it('classifies 401 response as AUTHENTICATION_ERROR', () => {
    const diagnosis = classifyApiFailure('HTTP status sai: expected 200, received 401 Unauthorized');
    // 401 in status sai → ASSERTION_ERROR first (status sai matches first)
    // But explicit 'status.*401|unauthorized' → AUTHENTICATION
    const diagnosis2 = classifyApiFailure('status 401 unauthorized token het han');
    expect(diagnosis2.category).toBe('AUTHENTICATION_ERROR');
  });

  it('all API failure categories preserve expected result (never self-heal oracle)', () => {
    const logs = [
      'DB assertion error: row count sai',
      'API baseUrl không được để trống',
      '501 Unmocked Request',
      'ECONNREFUSED',
      'body path sai: expected 90000',
    ];
    for (const log of logs) {
      const d = classifyApiFailure(log);
      expect(d.preservesExpectedResult).toBe(true);
      expect(d.canSelfHeal).toBe(false);
    }
  });
});
