import fs from 'fs';
import path from 'path';
import type { IntegrationConfig } from './schema.js';

export function defaultConfig(projectRoot = process.cwd()): IntegrationConfig {
  return {
    version: 1,
    projectName: path.basename(projectRoot),
    projectRoot,
    testDirectory: 'tests/integration',
    database: {
      strategy: 'TESTCONTAINERS',
      engine: 'postgres',
      image: 'postgres:17',
      databaseName: 'shopee_clone_test',
      migrationCommand: undefined,
      seedCommand: undefined,
    },
    externalMocks: {
      mode: 'IN_PROCESS_MSW',
      fakeServices: [],
    },
    appServer: {
      enabled: false,
      startCommand: 'npm run start:test',
      healthEndpoint: 'http://localhost:3000/api/health',
      startupTimeoutMs: 15000,
    },
    security: {
      blockProductionUrls: true,
      allowedHostnames: ['localhost', '127.0.0.1'],
      redactSecretsInLogs: true,
    },
  };
}

export function loadIntegrationConfig(
  customPath?: string,
  projectRoot = process.cwd(),
): IntegrationConfig {
  const configPath = customPath
    ? path.resolve(projectRoot, customPath)
    : path.resolve(projectRoot, 'testkit.integration.json');

  if (!fs.existsSync(configPath)) {
    return defaultConfig(projectRoot);
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<IntegrationConfig>;
    const defaults = defaultConfig(projectRoot);

    return {
      version: 1,
      projectName: parsed.projectName || defaults.projectName,
      projectRoot: parsed.projectRoot || defaults.projectRoot,
      testDirectory: parsed.testDirectory || defaults.testDirectory,
      database: { ...defaults.database, ...parsed.database } as any,
      externalMocks: { ...defaults.externalMocks, ...parsed.externalMocks },
      appServer: { ...defaults.appServer, ...parsed.appServer },
      security: { ...defaults.security, ...parsed.security },
    };
  } catch (error: any) {
    throw new Error(`[Integration Config] Không thể parse file cấu hình "${configPath}": ${error.message}`);
  }
}
