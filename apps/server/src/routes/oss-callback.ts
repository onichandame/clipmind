import { Hono } from "hono";
import { assets } from "@clipmind/db";
import { eq } from "drizzle-orm";
import { db } from "../db";

const app = new Hono();

app.post("/", async (c) => {
  try {
    console.log("\n==========================================");
    console.log("[DEBUG: OSS-Callback] 1. 收到客户端落盘 POST 请求");
    const body = await c.req.json();
    console.log("[DEBUG: OSS-Callback] 2. 解析的请求体:", JSON.stringify(body));
    const { filename, objectKey, fileSize, duration } = body;

    if (!filename || !objectKey) {
      return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400 });
    }

    // 防御：Webhook 幂等性校验，防止上游回调重试导致的主键冲突和数据污染
    console.log(`[DEBUG: OSS-Callback] 3. 开始执行幂等性校验, objectKey: ${objectKey}`);
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
    console.log(`[DEBUG: OSS-Callback] 4. 准备动态导入 aliyun-asr 模块...`);
    import('../utils/aliyun-asr').then(({ submitAliyunAsrTask }) => {
      console.log(`[DEBUG: OSS-Callback] 5. 模块导入成功，正在调用 submitAliyunAsrTask`);
      // 注意：如果是私有 Bucket，这里需要生成带时效的预签名 URL 再传递
      submitAliyunAsrTask(assetId, objectKey).catch(err => {
        console.error("[DEBUG: OSS-Callback] ❌ submitAliyunAsrTask 内部抛出异常:", err);
      });
    }).catch(err => {
      console.error("[DEBUG: OSS-Callback] ❌ 动态导入 aliyun-asr 失败:", err);
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
