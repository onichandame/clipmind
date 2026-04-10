import OSS from 'ali-oss';
import { Hono } from 'hono';

const app = new Hono();

app.post("/", async (c) => {
  try {
    const body = await c.req.json();
    // 👉 核心修改 1：同时接收前端传来的文件类型
    const { filename, contentType } = body; 
    
    if (!filename) return new Response(JSON.stringify({ error: 'Filename is required' }), { status: 400 });

    if (!process.env.ALIYUN_OSS_REGION || !process.env.ALIYUN_ACCESS_KEY_ID || !process.env.ALIYUN_ACCESS_KEY_SECRET || !process.env.ALIYUN_OSS_BUCKET) {
      throw new Error('❌ OSS 环境变量未配置齐全');
    }

    const uniqueId = crypto.randomUUID();
    const ext = filename.split('.').pop() || 'mp4';
    const objectKey = `clipmind/assets/${uniqueId}.${ext}`;

    const client = new OSS({
      region: process.env.ALIYUN_OSS_REGION,
      accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
      accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
      bucket: process.env.ALIYUN_OSS_BUCKET,
      secure: true,
    });

    // 👉 核心修改 2：把 Content-Type 纳入签名加密计算！
    const url = client.signatureUrl(objectKey, {
      expires: 3600,
      method: 'PUT',
      'Content-Type': contentType || 'application/octet-stream', 
    });

    return new Response(JSON.stringify({ uploadUrl: url, objectKey }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ OSS 签名生成失败:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate token' }), { status: 500 });
  }
});

export default app;
