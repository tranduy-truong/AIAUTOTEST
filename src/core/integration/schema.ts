export type IntegrationDbStrategyType =
  | 'TESTCONTAINERS'
  | 'SQLITE_MEMORY'
  | 'EXTERNAL_TEST_DB';

export type IntegrationDbEngine = 'postgres' | 'mysql' | 'sqlite';

export type IntegrationExternalMockMode = 'IN_PROCESS_MSW' | 'FAKE_HTTP_SERVER';

export type DatabaseContainerMode =
  | 'REAL_CONTAINER'
  | 'FILE_SQLITE'
  | 'EXTERNAL_TEST_DB'
  | 'INFRASTRUCTURE_UNAVAILABLE';

export interface DatabaseContainerInstance {
  databaseUrl: string;
  port: number;
  mode: DatabaseContainerMode;
  containerObj?: any;
  db?: any;
  sqliteFilePath?: string;
  stop: () => Promise<void>;
}

export interface PostgresContainerStrategyConfig {
  strategy: 'TESTCONTAINERS';
  engine: 'postgres';
  image: string; // e.g. "postgres:17"
  databaseName: string;
  migrationCommand?: string;
  seedCommand?: string;
  cleanupCommand?: string;
}

export interface MysqlContainerStrategyConfig {
  strategy: 'TESTCONTAINERS';
  engine: 'mysql';
  image: string; // e.g. "mysql:8"
  databaseName: string;
  migrationCommand?: string;
  seedCommand?: string;
  cleanupCommand?: string;
}

export interface SqliteMemoryStrategyConfig {
  strategy: 'SQLITE_MEMORY';
  engine: 'sqlite';
  migrationCommand?: string;
  seedCommand?: string;
}

export interface ExternalTestDbStrategyConfig {
  strategy: 'EXTERNAL_TEST_DB';
  connectionEnv: string; // e.g. "DATABASE_URL"
  migrationCommand?: string;
  seedCommand?: string;
}

export type IntegrationDatabaseConfig =
  | PostgresContainerStrategyConfig
  | MysqlContainerStrategyConfig
  | SqliteMemoryStrategyConfig
  | ExternalTestDbStrategyConfig;

export interface FakeHttpEndpointStub {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string; // e.g. "/api/v1/charge"
  status: number;
  responseBody: unknown;
  delayMs?: number;
}

export interface FakeHttpMockService {
  name: string; // e.g. "PAYMENT_API"
  envVar: string; // e.g. "PAYMENT_API_URL"
  stubs: FakeHttpEndpointStub[];
}

export interface IntegrationExternalMocksConfig {
  mode: IntegrationExternalMockMode;
  fakeServices?: FakeHttpMockService[];
}

export interface IntegrationAppServerConfig {
  enabled: boolean;
  startCommand: string; // e.g. "npm run start:test"
  healthEndpoint: string; // e.g. "http://localhost:3000/api/health"
  startupTimeoutMs: number;
  env?: Record<string, string>;
}

export interface IntegrationSecurityPolicyConfig {
  blockProductionUrls: boolean;
  allowedHostnames: string[];
  redactSecretsInLogs: boolean;
}

export interface IntegrationVerificationContract {
  databaseAssertions?: Array<{ table: string; minRows?: number }>;
  unmockedRequestPolicy?: 'FAIL' | 'WARN';
}

export interface IntegrationConfig {
  version: 1;
  projectName: string;
  projectRoot: string;
  testDirectory: string;
  database: IntegrationDatabaseConfig;
  externalMocks: IntegrationExternalMocksConfig;
  appServer: IntegrationAppServerConfig;
  security: IntegrationSecurityPolicyConfig;
  verificationContract?: IntegrationVerificationContract;
}

export interface IntegrationRunContext {
  runId: string;
  runDirectory: string;
  databaseUrl: string;
  allocatedPorts: Record<string, number>;
  activeServices: string[];
  startedAt: string;
}

export interface IntegrationStepLog {
  stepIndex: number;
  name: string;
  ok: boolean;
  durationMs: number;
  detail?: string;
  error?: string;
}

export interface IntegrationRunResult {
  ok: boolean;
  runId: string;
  durationMs: number;
  steps: IntegrationStepLog[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  failedTestNames: string[];
  reportPath: string;
}
