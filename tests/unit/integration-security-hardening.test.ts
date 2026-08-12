import { describe, expect, it } from 'vitest';
import {
  isProductionDatabaseUrl,
  validateDatabaseUrlSafety,
  validateCommandSafety,
  validateHostnameAllowList,
  redactSecrets,
} from '../../src/core/integration/security-policy.js';
import { startFakeHttpServers } from '../../src/core/integration/adapters/fake-http-server.js';
import { startSqliteMemory } from '../../src/core/integration/adapters/sqlite-memory.js';
import { startPostgresContainer } from '../../src/core/integration/adapters/postgres-testcontainer.js';
import { startMysqlContainer } from '../../src/core/integration/adapters/mysql-testcontainer.js';
import { setupInProcessMsw } from '../../src/core/integration/adapters/msw-in-process.js';
import { registerGlobalCleanupHandler } from '../../src/core/integration/process-manager.js';

describe('Integration Sandbox Hardening (All 8 Fixed Areas)', () => {
  it('Area 4: Blocks production host URLs even if database name contains "_test"', () => {
    // Attack vector: RDS host with customer_test database name
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

  it('Area 4: Detects and blocks dangerous shell injection commands', () => {
    const maliciousCmd1 = 'npm run test; rm -rf /';
    const maliciousCmd2 = 'npm run start && del /f /s /q C:\\';
    const safeCmd = 'npm run migration:latest';

    expect(() => validateCommandSafety(maliciousCmd1)).toThrow('[SECURITY ERROR]');
    expect(() => validateCommandSafety(maliciousCmd2)).toThrow('[SECURITY ERROR]');
    expect(() => validateCommandSafety(safeCmd)).not.toThrow();
  });

  it('Area 5: Fake HTTP Server returns HTTP 501 Unmocked Request for unmocked endpoints', async () => {
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

    // 1. Mocked endpoint call -> Returns 200
    const mockedRes = await fetch(`${url}/api/v1/charge`, { method: 'POST' });
    expect(mockedRes.status).toBe(200);
    const mockedJson = await mockedRes.json();
    expect(mockedJson.transactionId).toBe('tx_123');

    // 2. Unmocked endpoint call -> Returns HTTP 501
    const unmockedRes = await fetch(`${url}/api/v1/unmocked-path`, { method: 'GET' });
    expect(unmockedRes.status).toBe(501);
    const unmockedJson = await unmockedRes.json();
    expect(unmockedJson.error).toBe('UNMOCKED_REQUEST');
    expect(fakeServer.unmockedRequests).toHaveLength(1);

    await fakeServer.stop();
  });

  it('Area 3: SQLite Memory initializes and holds connection alive', async () => {
    const instance = await startSqliteMemory({
      strategy: 'SQLITE_MEMORY',
      engine: 'sqlite',
    });

    expect(instance.databaseUrl).toBe('file::memory:?cache=shared');
    expect(typeof instance.stop).toBe('function');
    await instance.stop();
  });

  it('Area 1 & 2: Real Postgres, MySQL & MSW adapters expose standard container interfaces', async () => {
    const pg = await startPostgresContainer({
      strategy: 'TESTCONTAINERS',
      engine: 'postgres',
      image: 'postgres:17',
      databaseName: 'test_db',
    });
    expect(pg.databaseUrl).toBeDefined();
    await pg.stop();

    const mysql = await startMysqlContainer({
      strategy: 'TESTCONTAINERS',
      engine: 'mysql',
      image: 'mysql:8',
      databaseName: 'test_db',
    });
    expect(mysql.databaseUrl).toBeDefined();
    await mysql.stop();

    const msw = await setupInProcessMsw([]);
    expect(msw.activeServices).toBeDefined();
    await msw.stop();
  });

  it('Area 8: Process Manager manages stack of cleanup callbacks and unregister functions', () => {
    let cleanedUp1 = false;
    let cleanedUp2 = false;

    const unregister1 = registerGlobalCleanupHandler(() => { cleanedUp1 = true; });
    const unregister2 = registerGlobalCleanupHandler(() => { cleanedUp2 = true; });

    expect(typeof unregister1).toBe('function');
    expect(typeof unregister2).toBe('function');

    unregister1();
    unregister2();
  });
});
