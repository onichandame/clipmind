import { Hono } from "hono";
import { db, assets } from "@clipmind/db";

const app = new Hono();

app.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const { filename, objectKey, fileSize, duration } = body;

    if (!filename || !objectKey) {
      return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400 });
    }

    // 将资产信息正式落盘到 MySQL
    await db.insert(assets).values({
      id: crypto.randomUUID(),
      filename: filename,
      ossUrl: objectKey,
      fileSize: fileSize || 0,
      duration: duration || 0, // 💡 新增：记录总时长
      status: 'ready',
    });

    console.log(`✅ Webhook 触发成功：已将 ${filename} 写入数据库！`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('❌ Webhook 写入数据库失败:', error);
    return new Response(JSON.stringify({ error: 'Database Error' }), { status: 500 });
  }
});

export default app;
