import type { SqliteMemoryStrategyConfig } from '../schema.js';
import type { DatabaseContainerInstance } from './postgres-testcontainer.js';

export interface SqliteMemoryInstance extends DatabaseContainerInstance {
  db?: any;
}

export async function startSqliteMemory(
  config: SqliteMemoryStrategyConfig,
): Promise<SqliteMemoryInstance> {
  console.log('⚡ [SQLite Sandbox] Đang mở kết nối SQLite In-Memory Database thực tế...');

  const databaseUrl = 'file::memory:?cache=shared';

  try {
    const sqlitePkg = 'better-sqlite3';
    // @ts-ignore
    const Database = (await import(/* @vite-ignore */ sqlitePkg)).default;
    const db = new Database(':memory:', { memory: true });

    // Enable shared cache and WAL mode for test concurrency
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    console.log('✅ [SQLite Sandbox] SQLite In-Memory Database đã mở kết nối và sẵn sàng.');

    return {
      databaseUrl,
      port: 0,
      db,
      stop: async () => {
        console.log('⚡ [SQLite Sandbox] Đóng kết nối SQLite In-Memory Database...');
        try {
          db.close();
        } catch {}
        console.log('✅ [SQLite Sandbox] Đã giải phóng SQLite Database.');
      },
    };
  } catch (sqliteError: any) {
    console.warn(
      `⚠️ [SQLite Warning] Driver native better-sqlite3 chưa sẵn sàng (${sqliteError.message}). Dùng URL fallback shared-memory: ${databaseUrl}`,
    );

    return {
      databaseUrl,
      port: 0,
      stop: async () => {
        console.log('⚡ [SQLite Fallback] Đã giải phóng tài nguyên SQLite.');
      },
    };
  }
}
