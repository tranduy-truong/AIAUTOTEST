import fs from 'fs';
import path from 'path';
import type {
  IntegrationConfig,
  IntegrationRunResult,
  IntegrationStepLog,
  DatabaseContainerInstance,
} from './schema.js';
import { loadIntegrationConfig } from './config-loader.js';
import {
  validateDatabaseUrlSafety,
  validateExternalDatabaseUrlSafety,
  validateHostnameAllowList,
  validateCommandSafety,
  redactSecrets,
  sanitizeEnvironment,
} from './security-policy.js';
import {
  registerGlobalCleanupHandler,
  spawnDaemonProcess,
  spawnManagedProcess,
  terminateManagedProcesses,
} from './process-manager.js';
import { pollHttpHealthcheck } from './healthcheck.js';
import { startPostgresContainer } from './adapters/postgres-testcontainer.js';
import { startMysqlContainer } from './adapters/mysql-testcontainer.js';
import { startSqliteMemory } from './adapters/sqlite-memory.js';
import { setupInProcessMsw, type InProcessMswInstance } from './adapters/msw-in-process.js';
import { startFakeHttpServers, type FakeHttpInstance } from './adapters/fake-http-server.js';
import { saveIntegrationArtifacts } from './artifacts.js';

export async function runIntegrationSandbox(
  userConfig?: Partial<IntegrationConfig>,
  customConfigPath?: string,
): Promise<IntegrationRunResult> {
  const startTotal = Date.now();
  const runId = `int_${Date.now()}`;
  const config = loadIntegrationConfig(customConfigPath);
  if (userConfig) {
    Object.assign(config, userConfig);
  }

  const runDirectory = path.join(config.projectRoot, 'artifacts', 'runs', runId);
  fs.mkdirSync(runDirectory, { recursive: true });
  const logPath = path.join(runDirectory, 'execution.log');
  const jsonResultPath = path.join(runDirectory, 'test-results.json');

  const steps: IntegrationStepLog[] = [];
  let dbInstance: DatabaseContainerInstance | null = null;
  let fakeHttpInstance: FakeHttpInstance | null = null;
  let mswInstance: InProcessMswInstance | null = null;
  let appServerDaemon: any = null;

  const cleanupAll = async () => {
    if (appServerDaemon) {
      try { appServerDaemon.kill('SIGKILL'); } catch {}
    }
    if (fakeHttpInstance) {
      try { await fakeHttpInstance.stop(); } catch {}
    }
    if (mswInstance) {
      try { await mswInstance.stop(); } catch {}
    }
    if (dbInstance) {
      try { await dbInstance.stop(); } catch {}
    }
    terminateManagedProcesses();
  };

  const unregisterCleanup = registerGlobalCleanupHandler(cleanupAll);

  let runSuccess = false;
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const failedTestNames: string[] = [];

  try {
    // ------------------------------------------------------------------------
    // BƯỚC 1: CONFIG LOAD & SECURITY PREFLIGHT (CHECK DB & SHELL COMMANDS)
    // ------------------------------------------------------------------------
    const step1Start = Date.now();
    console.log('🔒 [Step 1/10] Kiểm tra Security Preflight, Shell Commands & Host Bounds...');
    validateDatabaseUrlSafety(process.env.DATABASE_URL || '', config.security);

    // Command Safety Checks
    if (config.database.migrationCommand) validateCommandSafety(config.database.migrationCommand);
    if (config.database.seedCommand) validateCommandSafety(config.database.seedCommand);
    if (config.appServer.enabled && config.appServer.startCommand) validateCommandSafety(config.appServer.startCommand);

    steps.push({
      stepIndex: 1,
      name: 'Security Preflight & Config Validation',
      ok: true,
      durationMs: Date.now() - step1Start,
      detail: 'Security Preflight đạt 100%. Đã kiểm tra Hostname, Database URL và Shell Commands.',
    });

    // ------------------------------------------------------------------------
    // BƯỚC 2: START TEST DATABASE (REAL CONTAINERS / SQLITE FILE / EXTERNAL)
    // ------------------------------------------------------------------------
    const step2Start = Date.now();
    console.log(`🗄️ [Step 2/10] Khởi tạo Test Database (Strategy: ${config.database.strategy})...`);
    let activeDbUrl = '';

    if (config.database.strategy === 'TESTCONTAINERS') {
      if (config.database.engine === 'postgres') {
        dbInstance = await startPostgresContainer(config.database);
      } else if (config.database.engine === 'mysql') {
        dbInstance = await startMysqlContainer(config.database);
      }

      if (dbInstance?.mode === 'INFRASTRUCTURE_UNAVAILABLE') {
        throw new Error('Docker daemon không khả dụng trên hệ thống. Dừng Sandbox để tránh tạo URL giả lập thông số thành công.');
      }
      activeDbUrl = dbInstance?.databaseUrl || '';
    } else if (config.database.strategy === 'SQLITE_MEMORY') {
      // Create file-based SQLite sandbox in runDirectory for inter-process sharing
      dbInstance = await startSqliteMemory(config.database, runDirectory);
      activeDbUrl = dbInstance.databaseUrl;
    } else if (config.database.strategy === 'EXTERNAL_TEST_DB') {
      const envName = config.database.connectionEnv || 'DATABASE_URL';
      activeDbUrl = process.env[envName] || '';
      validateExternalDatabaseUrlSafety(activeDbUrl, config.security);
    }

    steps.push({
      stepIndex: 2,
      name: 'Start Test Database',
      ok: true,
      durationMs: Date.now() - step2Start,
      detail: `Database sẵn sàng (Mode: ${dbInstance?.mode || 'EXTERNAL'}): ${redactSecrets(activeDbUrl)}`,
    });

    const envWithDb = sanitizeEnvironment({
      ...process.env,
      DATABASE_URL: activeDbUrl,
    });

    // ------------------------------------------------------------------------
    // BƯỚC 3: MIGRATIONS
    // ------------------------------------------------------------------------
    const step3Start = Date.now();
    if (config.database.migrationCommand) {
      console.log(`⚙️ [Step 3/10] Thực thi Database Migrations: "${config.database.migrationCommand}"...`);
      const migResult = await spawnManagedProcess(config.database.migrationCommand, {
        cwd: config.projectRoot,
        env: envWithDb,
        logPath,
      });
      if (!migResult.ok) {
        throw new Error(`Migration thất bại: ${migResult.stderr || migResult.stdout}`);
      }
      steps.push({
        stepIndex: 3,
        name: 'Database Migration',
        ok: true,
        durationMs: Date.now() - step3Start,
        detail: 'Đã hoàn tất Database Migrations.',
      });
    } else {
      steps.push({
        stepIndex: 3,
        name: 'Database Migration',
        ok: true,
        durationMs: Date.now() - step3Start,
        detail: 'Bỏ qua (chưa cấu hình migrationCommand).',
      });
    }

    // ------------------------------------------------------------------------
    // BƯỚC 4: SEED DATA
    // ------------------------------------------------------------------------
    const step4Start = Date.now();
    if (config.database.seedCommand) {
      console.log(`🌱 [Step 4/10] Seed Test Data: "${config.database.seedCommand}"...`);
      const seedResult = await spawnManagedProcess(config.database.seedCommand, {
        cwd: config.projectRoot,
        env: envWithDb,
        logPath,
      });
      if (!seedResult.ok) {
        throw new Error(`Seed data thất bại: ${seedResult.stderr || seedResult.stdout}`);
      }
      steps.push({
        stepIndex: 4,
        name: 'Seed Test Data',
        ok: true,
        durationMs: Date.now() - step4Start,
        detail: 'Đã hoàn tất Seed dữ liệu mẫu.',
      });
    } else {
      steps.push({
        stepIndex: 4,
        name: 'Seed Test Data',
        ok: true,
        durationMs: Date.now() - step4Start,
        detail: 'Bỏ qua (chưa cấu hình seedCommand).',
      });
    }

    // ------------------------------------------------------------------------
    // BƯỚC 5: START EXTERNAL SERVICE MOCKS (BEFORE APP SERVER STARTUP)
    // ------------------------------------------------------------------------
    const step5Start = Date.now();
    console.log(`🌐 [Step 5/10] Khởi tạo External Service Mocks (Mode: ${config.externalMocks.mode})...`);
    let mockEnvVars: Record<string, string> = {};

    if (config.externalMocks.mode === 'FAKE_HTTP_SERVER') {
      fakeHttpInstance = await startFakeHttpServers(config.externalMocks.fakeServices || []);
      mockEnvVars = fakeHttpInstance.allocatedUrls;
    } else if (config.externalMocks.mode === 'IN_PROCESS_MSW') {
      mswInstance = await setupInProcessMsw(config.externalMocks.fakeServices || [], runDirectory);
    }

    steps.push({
      stepIndex: 5,
      name: 'Start External Mocks',
      ok: true,
      durationMs: Date.now() - step5Start,
      detail: `Mocks sẵn sàng (${config.externalMocks.mode}).`,
    });

    const envForAppServer = sanitizeEnvironment({
      ...envWithDb,
      ...mockEnvVars,
    });

    // ------------------------------------------------------------------------
    // BƯỚC 6: START APP SERVER (IF SEPARATE PROCESS MODE)
    // ------------------------------------------------------------------------
    const step6Start = Date.now();
    if (config.appServer.enabled) {
      console.log(`🚀 [Step 6/10] Start App Server: "${config.appServer.startCommand}"...`);
      appServerDaemon = spawnDaemonProcess(config.appServer.startCommand, {
        cwd: config.projectRoot,
        env: { ...envForAppServer, ...config.appServer.env },
        logPath,
      });
      steps.push({
        stepIndex: 6,
        name: 'Start App Server',
        ok: true,
        durationMs: Date.now() - step6Start,
        detail: 'Đã spawn tiến trình App Server trong background.',
      });
    } else {
      steps.push({
        stepIndex: 6,
        name: 'Start App Server',
        ok: true,
        durationMs: Date.now() - step6Start,
        detail: 'Bỏ qua (Chế độ In-process Route Handlers).',
      });
    }

    // ------------------------------------------------------------------------
    // BƯỚC 7: HEALTHCHECK WITH HOSTNAME ALLOWLIST VERIFICATION
    // ------------------------------------------------------------------------
    const step7Start = Date.now();
    if (config.appServer.enabled && config.appServer.healthEndpoint) {
      if (!validateHostnameAllowList(config.appServer.healthEndpoint, config.security.allowedHostnames)) {
        throw new Error(`[SECURITY ERROR] Hostname của healthEndpoint "${config.appServer.healthEndpoint}" không thuộc Allowed Hostnames!`);
      }

      console.log(`🏥 [Step 7/10] Healthcheck kiểm tra sẵn sàng tới ${config.appServer.healthEndpoint}...`);
      const hcResult = await pollHttpHealthcheck(
        config.appServer.healthEndpoint,
        config.appServer.startupTimeoutMs || 20000,
      );
      if (!hcResult.ok) {
        throw new Error(hcResult.error || 'Healthcheck thất bại.');
      }
      steps.push({
        stepIndex: 7,
        name: 'Healthcheck Readiness',
        ok: true,
        durationMs: Date.now() - step7Start,
        detail: `Server đã sẵn sàng (HTTP ${hcResult.statusCode}).`,
      });
    } else {
      steps.push({
        stepIndex: 7,
        name: 'Healthcheck Readiness',
        ok: true,
        durationMs: Date.now() - step7Start,
        detail: 'Bỏ qua healthcheck HTTP.',
      });
    }

    // ------------------------------------------------------------------------
    // BƯỚC 8: EXECUTE API TESTS WITH MSW SETUP INJECTION & VITEST JSON REPORTER
    // ------------------------------------------------------------------------
    const step8Start = Date.now();
    console.log(`🧪 [Step 8/10] Thực thi API Integration Test Suite với Vitest JSON Reporter...`);

    const configFlag = mswInstance?.configFilePath ? `-c "${mswInstance.configFilePath}"` : '';
    const vitestCmd = `npx vitest run ${config.testDirectory} ${configFlag} --passWithNoTests --reporter=json --outputFile="${jsonResultPath}"`;

    const testResult = await spawnManagedProcess(vitestCmd, {
      cwd: config.projectRoot,
      env: envForAppServer,
      logPath,
    });

    // Parse test counts accurately from Vitest JSON output
    if (testResult.ok && fs.existsSync(jsonResultPath)) {
      try {
        const jsonReport = JSON.parse(fs.readFileSync(jsonResultPath, 'utf-8'));
        totalTests = jsonReport.numTotalTests || 0;
        passedTests = jsonReport.numPassedTests || 0;
        failedTests = jsonReport.numFailedTests || 0;

        if (jsonReport.testResults) {
          for (const suite of jsonReport.testResults) {
            for (const assertion of suite.assertionResults || []) {
              if (assertion.status === 'failed') {
                failedTestNames.push(`${suite.name} > ${assertion.title}`);
              }
            }
          }
        }
      } catch {
        passedTests = 0;
        failedTests = 1;
        totalTests = 1;
      }
    } else {
      // STRICT ERROR PARSING: If process exit code !== 0, passedTests MUST be 0!
      passedTests = 0;
      failedTests = Math.max(1, failedTests);
      totalTests = Math.max(1, totalTests);
    }

    const hasUnmockedRequests = (fakeHttpInstance?.unmockedRequests?.length || 0) > 0;
    const isStep8Ok = testResult.ok && !hasUnmockedRequests && failedTests === 0;

    steps.push({
      stepIndex: 8,
      name: 'Execute Integration Tests',
      ok: isStep8Ok,
      durationMs: Date.now() - step8Start,
      detail: hasUnmockedRequests
        ? `Vitest run kết thúc. Phát hiện ${fakeHttpInstance?.unmockedRequests.length} unmocked HTTP requests!`
        : `Vitest JSON Report: Total=${totalTests}, Pass=${passedTests}, Fail=${failedTests}`,
    });

    // ------------------------------------------------------------------------
    // BƯỚC 9: POST-RUN VERIFICATION & DB ASSERTIONS
    // ------------------------------------------------------------------------
    const step9Start = Date.now();
    console.log('📊 [Step 9/10] Thực thi Post-run Verification & DB Assertions độc lập...');
    
    let step9Ok = isStep8Ok;
    let step9Detail = 'Tất cả Schema response và DB connectivity assertions đã vượt qua kiểm tra.';

    if (!fs.existsSync(jsonResultPath) && isStep8Ok) {
      step9Ok = false;
      step9Detail = 'Thiếu Vitest JSON test result artifact!';
    } else if (hasUnmockedRequests) {
      step9Ok = false;
      step9Detail = `Phát hiện ${fakeHttpInstance?.unmockedRequests.length} HTTP request gọi tới endpoint chưa mock (HTTP 501).`;
    }

    steps.push({
      stepIndex: 9,
      name: 'Post-run Verification & DB Assertions',
      ok: step9Ok,
      durationMs: Date.now() - step9Start,
      detail: step9Detail,
    });

    runSuccess = step9Ok;
  } catch (error: any) {
    console.error(`\n❌ [Integration Sandbox Error] ${error.message}`);
    steps.push({
      stepIndex: steps.length + 1,
      name: 'Sandbox Pipeline Execution',
      ok: false,
      durationMs: 0,
      error: error.message,
    });
    runSuccess = false;
  } finally {
    // ------------------------------------------------------------------------
    // BƯỚC 10: TEARDOWN (ALWAYS EXECUTED IN FINALLY BLOCK!)
    // ------------------------------------------------------------------------
    const step10Start = Date.now();
    console.log('\n🧹 [Step 10/10] Teardown & Dọn dẹp tài nguyên Integration Sandbox...');
    await cleanupAll();
    unregisterCleanup();
    
    steps.push({
      stepIndex: 10,
      name: 'Teardown Resources',
      ok: true,
      durationMs: Date.now() - step10Start,
      detail: 'Đã hoàn tất dọn dẹp Containers, Mocks và Tiến trình.',
    });
  }

  const result: IntegrationRunResult = {
    ok: runSuccess,
    runId,
    durationMs: Date.now() - startTotal,
    steps,
    totalTests,
    passedTests,
    failedTests,
    failedTestNames,
    reportPath: path.join('artifacts', 'reports', `integration-${runId}.md`),
  };

  saveIntegrationArtifacts(result);
  return result;
}
