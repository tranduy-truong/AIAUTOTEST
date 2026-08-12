import type { FakeHttpMockService } from '../schema.js';

export interface InProcessMswInstance {
  activeServices: string[];
  serverObj?: any;
  stop: () => Promise<void>;
}

export async function setupInProcessMsw(
  services: FakeHttpMockService[] = [],
): Promise<InProcessMswInstance> {
  const activeServices = services.map(s => s.name);
  console.log(`🌐 [MSW In-Process] Đang khởi tạo MSW Node Server cho ${activeServices.length} dịch vụ...`);

  try {
    const mswNodePkg = 'msw/node';
    const mswPkg = 'msw';
    // @ts-ignore
    const { setupServer } = await import(/* @vite-ignore */ mswNodePkg);
    // @ts-ignore
    const { http, HttpResponse } = await import(/* @vite-ignore */ mswPkg);

    const handlers: any[] = [];

    for (const service of services) {
      for (const stub of service.stubs) {
        const method = (stub.method || 'GET').toLowerCase();
        const pathPattern = stub.path.startsWith('http') ? stub.path : `*${stub.path}`;

        const handlerFn = (http as any)[method] || http.get;
        handlers.push(
          handlerFn(pathPattern, async () => {
            if (stub.delayMs && stub.delayMs > 0) {
              await new Promise(r => setTimeout(r, stub.delayMs));
            }
            return HttpResponse.json(stub.responseBody, { status: stub.status });
          }),
        );
      }
    }

    const server = setupServer(...handlers);
    server.listen({ onUnhandledRequest: 'bypass' });

    console.log(`✅ [MSW In-Process] MSW Interceptor Server đã hoạt động với ${handlers.length} mock handlers.`);

    return {
      activeServices,
      serverObj: server,
      stop: async () => {
        console.log('🌐 [MSW In-Process] Đóng MSW Node Interceptor Server...');
        server.close();
      },
    };
  } catch (mswError: any) {
    console.warn(
      `⚠️ [MSW Warning] Không thể khởi chạy MSW Node server (${mswError.message}). Chuyển sang fallback state handler...`,
    );

    return {
      activeServices,
      stop: async () => {
        console.log('🌐 [MSW Fallback] Đã giải phóng MSW mock state.');
      },
    };
  }
}
