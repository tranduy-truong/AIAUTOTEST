import fs from 'fs';
import path from 'path';
import type { FakeHttpMockService } from '../schema.js';

export interface InProcessMswInstance {
  activeServices: string[];
  setupFilePath?: string;
  configFilePath?: string;
  stop: () => Promise<void>;
}

export async function setupInProcessMsw(
  services: FakeHttpMockService[] = [],
  runDirectory = process.cwd(),
): Promise<InProcessMswInstance> {
  const activeServices = services.map(s => s.name);
  if (services.length === 0) {
    return {
      activeServices: [],
      stop: async () => {},
    };
  }

  const setupFilePath = path.join(runDirectory, 'vitest-msw-setup.ts');
  const configFilePath = path.join(runDirectory, 'vitest.config.ts');

  console.log(`🌐 [MSW In-Process] Đang khởi tạo Vitest setup file injection cho MSW (${activeServices.length} services)...`);

  const handlerStatements: string[] = [];

  for (const service of services) {
    for (const stub of service.stubs) {
      const method = (stub.method || 'GET').toLowerCase();
      const pathPattern = stub.path.startsWith('http') ? stub.path : `*${stub.path}`;
      const responseBodyJson = JSON.stringify(stub.responseBody);
      const delayMs = stub.delayMs || 0;

      handlerStatements.push(`
  http.${method}('${pathPattern}', async () => {
    ${delayMs > 0 ? `await new Promise(r => setTimeout(r, ${delayMs}));` : ''}
    return HttpResponse.json(${responseBodyJson}, { status: ${stub.status} });
  })`);
    }
  }

  const setupFileContent = `// Auto-generated Vitest MSW Setup File by Playwright-AI-TestKit
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

export const handlers = [${handlerStatements.join(',')}\n];

export const server = setupServer(...handlers);

if (typeof beforeAll !== 'undefined') {
  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}
`;

  const normalizedSetupPath = setupFilePath.replace(/\\/g, '/');
  const configContent = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['${normalizedSetupPath}'],
  },
});
`;

  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(setupFilePath, setupFileContent);
  fs.writeFileSync(configFilePath, configContent);

  console.log(`✅ [MSW In-Process] Đã tạo Vitest MSW Config & Setup File tại: ${configFilePath}`);

  return {
    activeServices,
    setupFilePath,
    configFilePath,
    stop: async () => {
      if (fs.existsSync(setupFilePath)) {
        try { fs.rmSync(setupFilePath, { force: true }); } catch {}
      }
      if (fs.existsSync(configFilePath)) {
        try { fs.rmSync(configFilePath, { force: true }); } catch {}
      }
      console.log('🌐 [MSW In-Process] Đã dọn dẹp Vitest MSW Setup File.');
    },
  };
}
