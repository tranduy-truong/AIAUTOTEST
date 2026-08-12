import http from 'http';
import type { FakeHttpMockService } from '../schema.js';
import { findFreePort } from '../process-manager.js';

export interface UnmockedRequestLog {
  service: string;
  method: string;
  url: string;
  timestamp: string;
}

export interface FakeHttpInstance {
  allocatedPorts: Record<string, number>;
  allocatedUrls: Record<string, string>;
  unmockedRequests: UnmockedRequestLog[];
  stop: () => Promise<void>;
}

export async function startFakeHttpServers(
  services: FakeHttpMockService[] = [],
): Promise<FakeHttpInstance> {
  const allocatedPorts: Record<string, number> = {};
  const allocatedUrls: Record<string, string> = {};
  const unmockedRequests: UnmockedRequestLog[] = [];
  const servers: http.Server[] = [];

  for (const service of services) {
    const port = await findFreePort();
    allocatedPorts[service.name] = port;
    const url = `http://127.0.0.1:${port}`;
    allocatedUrls[service.envVar] = url;

    const server = http.createServer((req, res) => {
      const reqMethod = (req.method || 'GET').toUpperCase();
      const reqUrl = req.url || '/';

      const match = service.stubs.find(
        stub =>
          stub.method.toUpperCase() === reqMethod &&
          (stub.path === reqUrl || reqUrl.startsWith(stub.path)),
      );

      if (match) {
        const delay = match.delayMs || 0;
        setTimeout(() => {
          res.writeHead(match.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(match.responseBody));
        }, delay);
      } else {
        // UNMOCKED ENDPOINT ENFORCEMENT: Return HTTP 501 Unmocked Request!
        const logEntry: UnmockedRequestLog = {
          service: service.name,
          method: reqMethod,
          url: reqUrl,
          timestamp: new Date().toISOString(),
        };
        unmockedRequests.push(logEntry);

        console.warn(
          `⚠️ [Fake HTTP Server - ${service.name}] Nhận request chưa được khai báo stub: ${reqMethod} ${reqUrl} -> Trả về HTTP 501 Unmocked Request`,
        );

        res.writeHead(501, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'UNMOCKED_REQUEST',
            message: `Endpoint ${reqMethod} ${reqUrl} chưa được khai báo stub trong FakeHttpService "${service.name}".`,
            unmockedRequest: logEntry,
          }),
        );
      }
    });

    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    servers.push(server);
    console.log(`🌐 [Fake HTTP Server] ${service.name} đang lắng nghe tại ${url} (${service.envVar})`);
  }

  return {
    allocatedPorts,
    allocatedUrls,
    unmockedRequests,
    stop: async () => {
      for (const server of servers) {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
      console.log('🌐 [Fake HTTP Server] Đã đóng toàn bộ Fake HTTP Servers.');
    },
  };
}
