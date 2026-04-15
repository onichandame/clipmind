import { Hono } from "hono";
import { assets } from "@clipmind/db";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";

const app = new Hono();

app.get("/", async (c) => {
  try {
    const allAssets = await db.select().from(assets).orderBy(desc(assets.createdAt));
    
    // 架构升级：基于现有环境变量动态拼装 OSS 绝对路径 (DRY 原则)
    const region = process.env.ALIYUN_OSS_REGION || '';
    const bucket = process.env.ALIYUN_OSS_BUCKET || '';
    const baseUrl = `https://${bucket}.${region}.aliyuncs.com`;
    
    const mappedAssets = allAssets.map(asset => ({
      ...asset,
      ossUrl: asset.ossUrl ? `${baseUrl}/${asset.ossUrl}` : asset.ossUrl,
      audioOssUrl: asset.audioOssUrl ? `${baseUrl}/${asset.audioOssUrl}` : asset.audioOssUrl,
      thumbnailUrl: asset.thumbnailUrl ? `${baseUrl}/${asset.thumbnailUrl}` : asset.thumbnailUrl,
    }));

    return c.json(mappedAssets);
  } catch (error) {
    console.error('❌ 获取资产列表失败:', error);
    return c.json({ error: 'Database Error' }, 500);
  }
});

app.post("/report", async (c) => {
  try {
    const body = await c.req.json();
    const { id, filename, duration, ossUrl, audioOssUrl, thumbnailUrl, fileSize } = body;

    await db.insert(assets).values({
      id,
      filename,
      ossUrl,
      audioOssUrl,
      thumbnailUrl,
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

app.delete("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    await db.delete(assets).where(eq(assets.id, id));
    return c.json({ success: true });
  } catch (error) {
    console.error('❌ 删除资产失败:', error);
    return c.json({ error: 'Database Delete Error' }, 500);
  }
});

export default app;
