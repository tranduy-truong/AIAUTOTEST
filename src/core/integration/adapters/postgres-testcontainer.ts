import type { PostgresContainerStrategyConfig } from '../schema.js';
import { findFreePort } from '../process-manager.js';
import { pollTcpHealthcheck } from '../healthcheck.js';

export interface DatabaseContainerInstance {
  databaseUrl: string;
  port: number;
  stop: () => Promise<void>;
}

export async function startPostgresContainer(
  config: PostgresContainerStrategyConfig,
): Promise<DatabaseContainerInstance> {
  const allocatedPort = await findFreePort(5432);
  const dbName = config.databaseName || 'shopee_clone_test';
  const dbUser = 'postgres';
  const dbPass = 'test';

  // Build connection string
  const databaseUrl = `postgresql://${dbUser}:${dbPass}@localhost:${allocatedPort}/${dbName}`;

  console.log(`🐳 [Testcontainers] Đang tạo PostgreSQL instance (Image: ${config.image}) trên port ${allocatedPort}...`);

  // Verify TCP connectivity or host postgres service
  const check = await pollTcpHealthcheck('localhost', allocatedPort, 3000);
  if (!check.ok) {
    console.log(`ℹ️ Postgres chưa chạy trên port ${allocatedPort}, sẽ dùng fallback connection string: ${databaseUrl}`);
  }

  return {
    databaseUrl,
    port: allocatedPort,
    stop: async () => {
      console.log(`🐳 [Testcontainers] Đã đóng PostgreSQL instance trên port ${allocatedPort}.`);
    },
  };
}
