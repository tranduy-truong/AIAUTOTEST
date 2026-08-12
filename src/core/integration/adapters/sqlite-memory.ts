import fs from 'fs';
import path from 'path';
import type { SqliteMemoryStrategyConfig, DatabaseContainerInstance } from '../schema.js';

export async function startSqliteMemory(
  config: SqliteMemoryStrategyConfig,
  runDirectory = process.cwd(),
): Promise<DatabaseContainerInstance> {
  const sqliteFilePath = path.join(runDirectory, 'sandbox-integration.sqlite');
  fs.mkdirSync(path.dirname(sqliteFilePath), { recursive: true });

  const databaseUrl = `file:${sqliteFilePath}`;
  console.log(`⚡ [SQLite Sandbox] Đang khởi tạo SQLite Database file chia sẻ xuyên process: ${sqliteFilePath}...`);

  try {
    const sqlitePkg = 'better-sqlite3';
    // @ts-ignore
    const Database = (await import(/* @vite-ignore */ sqlitePkg)).default;
    const db = new Database(sqliteFilePath);

    // Enable WAL mode and foreign keys
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    console.log('✅ [SQLite Sandbox] File SQLite Sandbox đã khởi tạo thành công và sẵn sàng chia sẻ.');

    return {
      databaseUrl,
      port: 0,
      mode: 'FILE_SQLITE',
      db,
      sqliteFilePath,
      stop: async () => {
        console.log('⚡ [SQLite Sandbox] Đóng và giải phóng file SQLite Database...');
        try {
          db.close();
        } catch {}
        if (fs.existsSync(sqliteFilePath)) {
          try { fs.rmSync(sqliteFilePath, { force: true }); } catch {}
        }
        console.log('✅ [SQLite Sandbox] Đã dọn dẹp file SQLite Database tạm.');
      },
    };
  } catch (sqliteError: any) {
    console.warn(
      `ℹ️ [SQLite Fallback] Driver better-sqlite3 native chưa cài đặt (${sqliteError.message}). Dùng file SQLite chuẩn: ${sqliteFilePath}`,
    );

    return {
      databaseUrl,
      port: 0,
      mode: 'FILE_SQLITE',
      sqliteFilePath,
      stop: async () => {
        if (fs.existsSync(sqliteFilePath)) {
          try { fs.rmSync(sqliteFilePath, { force: true }); } catch {}
        }
      },
    };
  }
}
