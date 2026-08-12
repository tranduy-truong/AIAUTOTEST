import type { MysqlContainerStrategyConfig, DatabaseContainerInstance } from '../schema.js';

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
      mode: 'REAL_CONTAINER',
      containerObj: container,
      stop: async () => {
        console.log(`🐳 [Testcontainers] Đang dừng container MySQL (Port: ${port})...`);
        await container.stop();
        console.log(`✅ [Testcontainers] Đã dừng hoàn toàn MySQL Container.`);
      },
    };
  } catch (dockerError: any) {
    console.warn(
      `⚠️ [Testcontainers Error] Không thể khởi chạy Docker Container thật (${dockerError.message}). Dừng Sandbox để tránh tạo URL giả.`,
    );

    return {
      databaseUrl: '',
      port: 0,
      mode: 'INFRASTRUCTURE_UNAVAILABLE',
      stop: async () => {},
    };
  }
}
