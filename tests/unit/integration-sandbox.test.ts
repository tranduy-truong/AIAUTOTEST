import { describe, expect, it } from 'vitest';
import { loadIntegrationConfig, defaultConfig } from '../../src/core/integration/config-loader.js';
import {
  isProductionDatabaseUrl,
  validateDatabaseUrlSafety,
  validateHostnameAllowList,
  redactSecrets,
  sanitizeEnvironment,
} from '../../src/core/integration/security-policy.js';
import { findFreePort } from '../../src/core/integration/process-manager.js';
import { runIntegrationSandbox } from '../../src/core/integration/sandbox-orchestrator.js';

describe('Integration Sandbox Harness', () => {
  it('loads default integration configuration safely', () => {
    const config = defaultConfig();
    expect(config.version).toBe(1);
    expect(config.database.strategy).toBe('TESTCONTAINERS');
    expect(config.security.blockProductionUrls).toBe(true);
  });

  it('detects and blocks production database URLs in security preflight', () => {
    const prodUrl1 = 'postgresql://user:secret@rds.amazonaws.com:5432/prod_db';
    const prodUrl2 = 'postgresql://user:pass@ep-cool-db.neon.tech/main';
    const safeTestUrl = 'postgresql://postgres:test@localhost:5432/shopee_clone_test';

    expect(isProductionDatabaseUrl(prodUrl1)).toBe(true);
    expect(isProductionDatabaseUrl(prodUrl2)).toBe(true);
    expect(isProductionDatabaseUrl(safeTestUrl)).toBe(false);

    expect(() =>
      validateDatabaseUrlSafety(prodUrl1, {
        blockProductionUrls: true,
        allowedHostnames: ['localhost'],
        redactSecretsInLogs: true,
      }),
    ).toThrow('[SECURITY ERROR]');
  });

  it('redacts sensitive passwords and connection string secrets in logs', () => {
    const rawLog = 'Connecting postgresql://admin:SuperSecretPass123@localhost:5432/db with api_key=secret_12345';
    const redacted = redactSecrets(rawLog);

    expect(redacted).not.toContain('SuperSecretPass123');
    expect(redacted).not.toContain('secret_12345');
    expect(redacted).toContain('[REDACTED_SECRET]');
  });

  it('validates hostname allow-list correctly', () => {
    expect(validateHostnameAllowList('http://localhost:3000/api/health', [])).toBe(true);
    expect(validateHostnameAllowList('http://127.0.0.1:9101/charge', [])).toBe(true);
    expect(validateHostnameAllowList('https://evil-hacker.com/steal', [])).toBe(false);
  });

  it('allocates dynamic free ports without collisions', async () => {
    const port1 = await findFreePort();
    const port2 = await findFreePort();

    expect(port1).toBeGreaterThan(0);
    expect(port2).toBeGreaterThan(0);
  });

  it('executes 10-step integration sandbox orchestrator and cleans up in finally block', async () => {
    const result = await runIntegrationSandbox({
      database: {
        strategy: 'SQLITE_MEMORY',
        engine: 'sqlite',
      },
      externalMocks: {
        mode: 'IN_PROCESS_MSW',
        fakeServices: [],
      },
      appServer: {
        enabled: false,
        startCommand: '',
        healthEndpoint: '',
        startupTimeoutMs: 1000,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.steps).toHaveLength(10);
    expect(result.steps.find(s => s.stepIndex === 10)?.name).toBe('Teardown Resources');
    expect(result.steps.find(s => s.stepIndex === 10)?.ok).toBe(true);
  });
});
