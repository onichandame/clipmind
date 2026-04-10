import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required.");
}

const pool = mysql.createPool({
  uri: databaseUrl,
});

export const db = drizzle(pool, { schema, mode: "default" });
export { pool };
