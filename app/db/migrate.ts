import 'dotenv/config';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

async function runMigration() {
  console.log('⏳ 正在检查并执行数据库迁移...');
  if (!process.env.DATABASE_URL) throw new Error('❌ 未找到 DATABASE_URL');

  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const db = drizzle(connection);

  try {
    await migrate(db, { migrationsFolder: './app/db/migrations' });
    console.log('✅ 数据库迁移成功完成！');
  } catch (error) {
    console.error('❌ 数据库迁移失败:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}
runMigration();
