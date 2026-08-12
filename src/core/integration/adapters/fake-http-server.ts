import http from 'http';
import type { FakeHttpMockService } from '../schema.js';
import { findFreePort } from '../process-manager.js';

export interface FakeHttpInstance {
  allocatedPorts: Record<string, number>;
  allocatedUrls: Record<string, string>;
  stop: () => Promise<void>;
}

export async function startFakeHttpServers(
  services: FakeHttpMockService[] = [],
): Promise<FakeHttpInstance> {
  const allocatedPorts: Record<string, number> = {};
  const allocatedUrls: Record<string, string> = {};
  const servers: http.Server[] = [];

  for (const service of services) {
    const port = await findFreePort();
    allocatedPorts[service.name] = port;
    const url = `http://127.0.0.1:${port}`;
    allocatedUrls[service.envVar] = url;

    const server = http.createServer((req, res) => {
      const match = service.stubs.find(
        stub =>
          stub.method.toUpperCase() === (req.method || 'GET').toUpperCase() &&
          req.url?.startsWith(stub.path),
      );

      const delay = match?.delayMs || 0;
      setTimeout(() => {
        if (match) {
          res.writeHead(match.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(match.responseBody));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ mock: 'default-fake-response', service: service.name }));
        }
      }, delay);
    });

    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    servers.push(server);
    console.log(`🌐 [Fake HTTP Server] ${service.name} đang lắng nghe tại ${url} (${service.envVar})`);
  }

  return {
    allocatedPorts,
    allocatedUrls,
    stop: async () => {
      for (const server of servers) {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
      console.log('🌐 [Fake HTTP Server] Đã đóng toàn bộ Fake HTTP Servers.');
    },
  };
}
