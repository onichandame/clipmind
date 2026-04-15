import OSS from 'ali-oss';
import { Hono } from 'hono';

const app = new Hono();

app.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const { filename } = body;

    if (!filename) {
      return c.json({ error: 'filename is required' }, 400);
    }

    if (!process.env.ALIYUN_OSS_REGION || !process.env.ALIYUN_ACCESS_KEY_ID || !process.env.ALIYUN_ACCESS_KEY_SECRET || !process.env.ALIYUN_OSS_BUCKET) {
      throw new Error('❌ OSS 环境变量未配置齐全');
    }

    const uniqueId = crypto.randomUUID();
    const videoExt = (filename.split('.').pop() || 'mp4').toLowerCase();

    // 架构升级：资产作为顶级实体，直接存放在全局 assets 目录下
    const videoObjectKey = `assets/${uniqueId}/video.${videoExt}`;
    const audioObjectKey = `assets/${uniqueId}/audio.aac`;
    const thumbObjectKey = `assets/${uniqueId}/thumb.jpg`;

    const client = new OSS({
      region: process.env.ALIYUN_OSS_REGION,
      accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
      accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
      bucket: process.env.ALIYUN_OSS_BUCKET,
      secure: true,
    });

    // 并发生成两条上传轨道 (明确限定 Content-Type 防止直传被拦截)
    const videoUploadUrl = client.signatureUrl(videoObjectKey, {
      expires: 3600, method: 'PUT', 'Content-Type': 'video/' + (videoExt === 'mov' ? 'quicktime' : 'mp4')
    });
    const audioUploadUrl = client.signatureUrl(audioObjectKey, {
      expires: 3600, method: 'PUT', 'Content-Type': 'audio/aac'
    });
    const thumbUploadUrl = client.signatureUrl(thumbObjectKey, {
      expires: 3600, method: 'PUT', 'Content-Type': 'image/jpeg'
    });

    return c.json({
      assetId: uniqueId,
      videoUploadUrl,
      videoObjectKey,
      audioUploadUrl,
      audioObjectKey,
      thumbUploadUrl,
      thumbObjectKey
    }, 200);

  } catch (error) {
    console.error('❌ OSS 签名生成失败:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate token' }), { status: 500 });
  }
});

export default app;
