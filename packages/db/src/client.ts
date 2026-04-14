import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { migrate } from "drizzle-orm/mysql2/migrator";
import path from "path";
import * as schema from "./schema";

// 纯粹的工厂函数，由宿主环境注入配置
export const createDbClient = (databaseUrl: string) => {
  const pool = mysql.createPool({ uri: databaseUrl });
  return drizzle(pool, { schema, mode: "default" });
};

// 封装 migrate 逻辑，由 db 包自主管理内部路径
export const runMigrations = async (databaseUrl: string) => {
  const pool = mysql.createPool({ uri: databaseUrl });
  const db = drizzle(pool, { schema, mode: "default" });
  const migrationsFolder = path.resolve(__dirname, './migrations');
  await migrate(db, { migrationsFolder });
  await pool.end(); // 迁移执行完毕后释放连接池
};
