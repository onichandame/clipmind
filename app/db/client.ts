import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";
import { requireDatabaseUrl } from "../utils/env.server";

const pool = mysql.createPool({
  uri: requireDatabaseUrl(),
});

export const db = drizzle(pool, { schema, mode: "default" });
export { pool };
