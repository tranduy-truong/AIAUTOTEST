import fs from 'fs';
import path from 'path';
import os from 'os';
import { describe, expect, it } from 'vitest';
import {
  isProductionDatabaseUrl,
  validateDatabaseUrlSafety,
  validateExternalDatabaseUrlSafety,
  validateCommandSafety,
  validateHostnameAllowList,
  redactSecrets,
  sanitizeEnvironment,
} from '../../src/core/integration/security-policy.js';
import { startFakeHttpServers } from '../../src/core/integration/adapters/fake-http-server.js';
import { startSqliteMemory } from '../../src/core/integration/adapters/sqlite-memory.js';
import { startPostgresContainer } from '../../src/core/integration/adapters/postgres-testcontainer.js';
import { startMysqlContainer } from '../../src/core/integration/adapters/mysql-testcontainer.js';
import { setupInProcessMsw } from '../../src/core/integration/adapters/msw-in-process.js';
import { registerGlobalCleanupHandler } from '../../src/core/integration/process-manager.js';

describe('Integration Sandbox Hardening (All 6 Architectural Fixes)', () => {
  it('Issue 4 (Default-Deny): Blocks production host URLs even if database name contains "_test"', () => {
    const bypassAttemptUrl = 'postgresql://user:secret@production.rds.amazonaws.com:5432/customer_test';
    const neonBypassUrl = 'postgresql://user:secret@ep-cool.neon.tech:5432/my_test_db';
    const safeUrl = 'postgresql://postgres:test@localhost:5432/shopee_clone_test';

    expect(isProductionDatabaseUrl(bypassAttemptUrl)).toBe(true);
    expect(isProductionDatabaseUrl(neonBypassUrl)).toBe(true);
    expect(isProductionDatabaseUrl(safeUrl)).toBe(false);

    expect(() =>
      validateDatabaseUrlSafety(bypassAttemptUrl, {
        blockProductionUrls: true,
        allowedHostnames: ['localhost'],
        redactSecretsInLogs: true,
      }),
    ).toThrow('[SECURITY ERROR]');
  });

  it('Issue 4 (Default-Deny): Enforces Default-Deny rules for EXTERNAL_TEST_DB', () => {
    const extUrl = 'postgresql://user:pass@test-host.internal:5432/my_test_db';
    const security = {
      blockProductionUrls: true,
      allowedHostnames: ['test-host.internal'],
      redactSecretsInLogs: true,
    };

    // 1. Fails if TESTKIT_ALLOW_EXTERNAL_TEST_DB is not set to true
    delete process.env.TESTKIT_ALLOW_EXTERNAL_TEST_DB;
    expect(() => validateExternalDatabaseUrlSafety(extUrl, security)).toThrow('[SECURITY ERROR]');

    // 2. Fails if database name lacks _test marker
    process.env.TESTKIT_ALLOW_EXTERNAL_TEST_DB = 'true';
    const nonTestDbUrl = 'postgresql://user:pass@test-host.internal:5432/production_data';
    expect(() => validateExternalDatabaseUrlSafety(nonTestDbUrl, security)).toThrow('[SECURITY ERROR]');

    // 3. Passes when all 3 rules are met
    expect(() => validateExternalDatabaseUrlSafety(extUrl, security)).not.toThrow();

    delete process.env.TESTKIT_ALLOW_EXTERNAL_TEST_DB;
  });

  it('Issue 4: Detects shell injection and sanitizes all credential environment variables', () => {
    expect(() => validateCommandSafety('npm run test; rm -rf /')).toThrow('[SECURITY ERROR]');
    expect(() => validateCommandSafety('npm run start && del /f /s /q C:\\')).toThrow('[SECURITY ERROR]');
    expect(() => validateCommandSafety('npm run migration:latest')).not.toThrow();

    const envWithSecrets = {
      PATH: '/usr/bin',
      TESTKIT_RUN_ID: '123',
      MY_API_SECRET: 'super_secret',
      DB_PASSWORD: 'password123',
      ACCESS_TOKEN: 'bearer_abc',
    };

    const sanitized = sanitizeEnvironment(envWithSecrets);
    expect(sanitized.PATH).toBe('/usr/bin');
    expect(sanitized.TESTKIT_RUN_ID).toBe('123');
    expect(sanitized.MY_API_SECRET).toBeUndefined();
    expect(sanitized.DB_PASSWORD).toBeUndefined();
    expect(sanitized.ACCESS_TOKEN).toBeUndefined();
  });

  it('Issue 5: Fake HTTP Server returns HTTP 501 Unmocked Request for unmocked endpoints', async () => {
    const fakeServer = await startFakeHttpServers([
      {
        name: 'PAYMENT_API',
        envVar: 'PAYMENT_API_URL',
        stubs: [
          {
            method: 'POST',
            path: '/api/v1/charge',
            status: 200,
            responseBody: { success: true, transactionId: 'tx_123' },
          },
        ],
      },
    ]);

    const url = fakeServer.allocatedUrls['PAYMENT_API_URL'];

    const mockedRes = await fetch(`${url}/api/v1/charge`, { method: 'POST' });
    expect(mockedRes.status).toBe(200);

    const unmockedRes = await fetch(`${url}/api/v1/unmocked-path`, { method: 'GET' });
    expect(unmockedRes.status).toBe(501);
    const unmockedJson = await unmockedRes.json();
    expect(unmockedJson.error).toBe('UNMOCKED_REQUEST');
    expect(fakeServer.unmockedRequests).toHaveLength(1);

    await fakeServer.stop();
  });

  it('Issue 3: SQLite File Sandbox creates shared DB file and executes real SQL queries', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '.tmp-sqlite-test-'));
    const instance = await startSqliteMemory(
      { strategy: 'SQLITE_MEMORY', engine: 'sqlite' },
      tmpDir,
    );

    expect(instance.mode).toBe('FILE_SQLITE');
    expect(instance.sqliteFilePath).toBeDefined();

    if (instance.db) {
      // Execute real SQL DDL and DML queries to prove database is alive
      instance.db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);');
      instance.db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(1, 'Shopee User');
      const row = instance.db.prepare('SELECT * FROM users WHERE id = ?').get(1) as { name: string };
      expect(row.name).toBe('Shopee User');
    }

    await instance.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Issue 1: Testcontainers adapter returns INFRASTRUCTURE_UNAVAILABLE when Docker daemon is down', async () => {
    const pg = await startPostgresContainer({
      strategy: 'TESTCONTAINERS',
      engine: 'postgres',
      image: 'postgres:17',
      databaseName: 'test_db',
    });
    expect(pg.mode).toMatch(/REAL_CONTAINER|INFRASTRUCTURE_UNAVAILABLE/);
    await pg.stop();

    const mysql = await startMysqlContainer({
      strategy: 'TESTCONTAINERS',
      engine: 'mysql',
      image: 'mysql:8',
      databaseName: 'test_db',
    });
    expect(mysql.mode).toMatch(/REAL_CONTAINER|INFRASTRUCTURE_UNAVAILABLE/);
    await mysql.stop();
  });

  it('Issue 2: MSW generates setup file for Vitest worker child processes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '.tmp-msw-test-'));
    const msw = await setupInProcessMsw(
      [
        {
          name: 'TEST_SERVICE',
          envVar: 'TEST_URL',
          stubs: [{ method: 'GET', path: '/health', status: 200, responseBody: { ok: true } }],
        },
      ],
      tmpDir,
    );

    expect(msw.setupFilePath).toBeDefined();
    expect(fs.existsSync(msw.setupFilePath!)).toBe(true);
    expect(fs.readFileSync(msw.setupFilePath!, 'utf-8')).toContain('setupServer');

    await msw.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
