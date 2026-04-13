import { Hono } from "hono";
import { db, assets } from "@clipmind/db";
import { desc } from "drizzle-orm";

const app = new Hono();

app.get("/", async (c) => {
  try {
    const allAssets = await db.select().from(assets).orderBy(desc(assets.createdAt));
    return c.json(allAssets);
  } catch (error) {
    console.error('❌ 获取资产列表失败:', error);
    return c.json({ error: 'Database Error' }, 500);
  }
});

export default app;
