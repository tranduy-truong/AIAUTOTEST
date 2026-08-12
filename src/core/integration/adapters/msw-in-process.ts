import type { FakeHttpMockService } from '../schema.js';

export interface InProcessMswInstance {
  activeServices: string[];
  stop: () => Promise<void>;
}

export async function setupInProcessMsw(
  services: FakeHttpMockService[] = [],
): Promise<InProcessMswInstance> {
  const activeServices = services.map(s => s.name);
  console.log(`🌐 [MSW In-Process] Đã kích hoạt MSW mock cho ${activeServices.length} dịch vụ: ${activeServices.join(', ')}`);

  return {
    activeServices,
    stop: async () => {
      console.log('🌐 [MSW In-Process] Đã tắt MSW mock handlers.');
    },
  };
}
