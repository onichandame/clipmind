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

app.post("/report", async (c) => {
  try {
    const body = await c.req.json();
    const { id, filename, duration, ossUrl, audioOssUrl, fileSize } = body;

    await db.insert(assets).values({
      id,
      filename,
      ossUrl,
      audioOssUrl,
      fileSize,
      duration,
      status: 'ready',
    });

    return c.json({ success: true, assetId: id });
  } catch (error) {
    console.error('❌ 资产入库失败:', error);
    return c.json({ error: 'Database Insert Error' }, 500);
  }
});

export default app;
