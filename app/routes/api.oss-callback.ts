import { db } from "../db/client";
import { assets } from "../db/schema";

export async function action({ request }: { request: Request }) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const body = await request.json();
    const { filename, objectKey, fileSize } = body;

    if (!filename || !objectKey) {
      return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400 });
    }

    // 将资产信息正式落盘到 MySQL
    await db.insert(assets).values({
      id: crypto.randomUUID(),
      filename: filename,
      ossUrl: objectKey, // 👉 核心修复：对齐前任的数据库 Schema，使用 ossUrl 字段！
      fileSize: fileSize || 0,
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
}
