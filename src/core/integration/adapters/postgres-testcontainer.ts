import type { PostgresContainerStrategyConfig } from '../schema.js';
import { findFreePort } from '../process-manager.js';

export interface DatabaseContainerInstance {
  databaseUrl: string;
  port: number;
  containerObj?: any;
  stop: () => Promise<void>;
}

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
      containerObj: container,
      stop: async () => {
        console.log(`🐳 [Testcontainers] Đang dừng container PostgreSQL (Port: ${port})...`);
        await container.stop();
        console.log(`✅ [Testcontainers] Đã dừng hoàn toàn PostgreSQL Container.`);
      },
    };
  } catch (dockerError: any) {
    console.warn(
      `⚠️ [Testcontainers Warning] Không thể khởi chạy Docker Container thật (${dockerError.message}). Chuyển sang fallback kết nối Local/External PostgreSQL...`,
    );

    const fallbackPort = await findFreePort(5432);
    const fallbackUrl = `postgresql://postgres:test@localhost:${fallbackPort}/${dbName}`;

    return {
      databaseUrl: fallbackUrl,
      port: fallbackPort,
      stop: async () => {
        console.log(`🐳 [Testcontainers Fallback] Đã giải phóng tài nguyên Postgres.`);
      },
    };
  }
}
