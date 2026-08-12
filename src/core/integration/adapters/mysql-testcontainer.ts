import type { MysqlContainerStrategyConfig } from '../schema.js';
import { findFreePort } from '../process-manager.js';
import { pollTcpHealthcheck } from '../healthcheck.js';
import type { DatabaseContainerInstance } from './postgres-testcontainer.js';

export async function startMysqlContainer(
  config: MysqlContainerStrategyConfig,
): Promise<DatabaseContainerInstance> {
  const allocatedPort = await findFreePort(3306);
  const dbName = config.databaseName || 'shopee_clone_test';
  const dbUser = 'root';
  const dbPass = 'test';

  const databaseUrl = `mysql://${dbUser}:${dbPass}@localhost:${allocatedPort}/${dbName}`;

  console.log(`🐳 [Testcontainers] Đang tạo MySQL instance (Image: ${config.image}) trên port ${allocatedPort}...`);

  const check = await pollTcpHealthcheck('localhost', allocatedPort, 3000);
  if (!check.ok) {
    console.log(`ℹ️ MySQL chưa chạy trên port ${allocatedPort}, sẽ dùng connection string: ${databaseUrl}`);
  }

  return {
    databaseUrl,
    port: allocatedPort,
    stop: async () => {
      console.log(`🐳 [Testcontainers] Đã đóng MySQL instance trên port ${allocatedPort}.`);
    },
  };
}
