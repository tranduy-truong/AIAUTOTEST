import type { PostgresContainerStrategyConfig, DatabaseContainerInstance } from '../schema.js';

export async function startPostgresContainer(
  config: PostgresContainerStrategyConfig,
): Promise<DatabaseContainerInstance> {
  const dbName = config.databaseName || 'shopee_clone_test';
  const imageName = config.image || 'postgres:17';

  console.log(`🐳 [Testcontainers] Đang khởi tạo PostgreSQL Container (Image: ${imageName})...`);

  try {
    const pkgName = '@testcontainers/postgresql';
    // @ts-ignore
    const { PostgreSqlContainer } = await import(/* @vite-ignore */ pkgName);
    const container = await new PostgreSqlContainer(imageName)
      .withDatabase(dbName)
      .withUsername('postgres')
      .withPassword('test')
      .start();

    const databaseUrl = container.getConnectionUri();
    const port = container.getMappedPort(5432);

    console.log(`✅ [Testcontainers] PostgreSQL Container đã khởi chạy thành công trên port ${port}`);

    return {
      databaseUrl,
      port,
      mode: 'REAL_CONTAINER',
      containerObj: container,
      stop: async () => {
        console.log(`🐳 [Testcontainers] Đang dừng container PostgreSQL (Port: ${port})...`);
        await container.stop();
        console.log(`✅ [Testcontainers] Đã dừng hoàn toàn PostgreSQL Container.`);
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
