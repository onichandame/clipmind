import { Hono } from 'hono';
import { signUploadUrl } from '../utils/oss';

const app = new Hono();

app.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const { filename } = body;

    if (!filename) {
      return c.json({ error: 'filename is required' }, 400);
    }

    const uniqueId = crypto.randomUUID();
    const videoExt = (filename.split('.').pop() || 'mp4').toLowerCase();

    // 架构升级：资产作为顶级实体，直接存放在全局 assets 目录下
    const videoObjectKey = `assets/${uniqueId}/video.${videoExt}`;
    const audioObjectKey = `assets/${uniqueId}/audio.aac`;
    const thumbObjectKey = `assets/${uniqueId}/thumb.jpg`;

    const videoContentType = 'video/' + (videoExt === 'mov' ? 'quicktime' : 'mp4');

    return c.json({
      assetId: uniqueId,
      videoUploadUrl: signUploadUrl(videoObjectKey, videoContentType),
      videoObjectKey,
      audioUploadUrl: signUploadUrl(audioObjectKey, 'audio/aac'),
      audioObjectKey,
      thumbUploadUrl: signUploadUrl(thumbObjectKey, 'image/jpeg'),
      thumbObjectKey
    }, 200);

  } catch (error) {
    console.error('❌ OSS 签名生成失败:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate token' }), { status: 500 });
  }
});

export default app;
