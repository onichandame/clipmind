import { Hono } from "hono";
import { assets } from "@clipmind/db";
import { eq } from "drizzle-orm";
import { db } from "../db";

const app = new Hono();

app.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const { filename, objectKey, fileSize, duration } = body;

    if (!filename || !objectKey) {
      return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400 });
    }

    // 防御：Webhook 幂等性校验，防止上游回调重试导致的主键冲突和数据污染
    const existing = await db.select().from(assets).where(eq(assets.ossUrl, objectKey)).limit(1);
    if (existing.length > 0) {
      console.log(`⚠️ Webhook 幂等拦截：${objectKey} 已存在，忽略重复请求。`);
      return new Response(JSON.stringify({ success: true, msg: "Idempotent return" }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const assetId = crypto.randomUUID();

    // 将资产信息正式落盘到 MySQL，初始化 ASR 状态机
    await db.insert(assets).values({
      id: assetId,
      filename: filename,
      ossUrl: objectKey,
      fileSize: fileSize || 0,
      duration: duration || 0,
      status: 'ready',
      asrStatus: 'pending'
    });

    console.log(`✅ Webhook 触发成功：已将 ${filename} 写入数据库！`);

    // 💡 异步触发 ASR 任务 (不阻塞 Webhook 响应)
    import('../utils/aliyun-asr').then(({ submitAliyunAsrTask }) => {
      // 注意：如果是私有 Bucket，这里需要生成带时效的预签名 URL 再传递
      submitAliyunAsrTask(assetId, objectKey).catch(console.error);
    });

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
