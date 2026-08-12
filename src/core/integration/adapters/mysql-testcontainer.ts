import type { MysqlContainerStrategyConfig } from '../schema.js';
import { findFreePort } from '../process-manager.js';
import type { DatabaseContainerInstance } from './postgres-testcontainer.js';

export async function startMysqlContainer(
  config: MysqlContainerStrategyConfig,
): Promise<DatabaseContainerInstance> {
  const dbName = config.databaseName || 'shopee_clone_test';
  const imageName = config.image || 'mysql:8';

  console.log(`🐳 [Testcontainers] Đang khởi tạo MySQL Container (Image: ${imageName})...`);

  try {
    const pkgName = '@testcontainers/mysql';
    // @ts-ignore
    const { MySqlContainer } = await import(/* @vite-ignore */ pkgName);
    const container = await new MySqlContainer(imageName)
      .withDatabase(dbName)
      .withRootPassword('test')
      .start();

    const databaseUrl = container.getConnectionUri();
    const port = container.getMappedPort(3306);

    console.log(`✅ [Testcontainers] MySQL Container đã khởi chạy thành công trên port ${port}`);

    return {
      databaseUrl,
      port,
      containerObj: container,
      stop: async () => {
        console.log(`🐳 [Testcontainers] Đang dừng container MySQL (Port: ${port})...`);
        await container.stop();
        console.log(`✅ [Testcontainers] Đã dừng hoàn toàn MySQL Container.`);
      },
    };
  } catch (dockerError: any) {
    console.warn(
      `⚠️ [Testcontainers Warning] Không thể khởi chạy Docker Container thật (${dockerError.message}). Chuyển sang fallback kết nối Local/External MySQL...`,
    );

    const fallbackPort = await findFreePort(3306);
    const fallbackUrl = `mysql://root:test@localhost:${fallbackPort}/${dbName}`;

    return {
      databaseUrl: fallbackUrl,
      port: fallbackPort,
      stop: async () => {
        console.log(`🐳 [Testcontainers Fallback] Đã giải phóng tài nguyên MySQL.`);
      },
    };
  }
}
