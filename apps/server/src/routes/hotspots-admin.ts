import { Hono } from 'hono';
import { runHotspotsPipeline } from '../jobs/hotspots-pipeline';

// 调试接口：手动触发留学热点采集管线。无 auth — 仅用于本地 / 内网调试。
// 上线前应当移除或加 auth + IP 白名单。
const app = new Hono();

app.post('/run', async (c) => {
  // fire-and-forget：管线一次跑可能数分钟（SearchAPI + Firecrawl + LLM），不能让 HTTP 请求挂着。
  // pipeline 内部有 isRunning 守卫，重复点击不会并发。
  runHotspotsPipeline()
    .then((r) => console.log('[Hotspots-Admin] 触发完成:', r))
    .catch((e) => console.error('[Hotspots-Admin] 触发失败:', e));
  return c.json({ started: true, hint: '管线已在后台运行，去看 server 日志（[Hotspots] 前缀）' }, 202);
});

export default app;
