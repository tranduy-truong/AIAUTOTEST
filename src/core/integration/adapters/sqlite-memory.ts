import type { SqliteMemoryStrategyConfig } from '../schema.js';
import type { DatabaseContainerInstance } from './postgres-testcontainer.js';

export async function startSqliteMemory(
  config: SqliteMemoryStrategyConfig,
): Promise<DatabaseContainerInstance> {
  const databaseUrl = 'file::memory:?cache=shared';
  console.log('⚡ [SQLite Sandbox] Đang khởi tạo SQLite In-Memory Database...');

  return {
    databaseUrl,
    port: 0,
    stop: async () => {
      console.log('⚡ [SQLite Sandbox] Đã giải phóng SQLite In-Memory Database.');
    },
  };
}
