import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import chatRoute from './routes/chat';
import ossCallbackRoute from './routes/oss-callback';
import uploadTokenRoute from './routes/upload-token';

const app = new Hono();

// 全局 CORS 策略，允许 Tauri 和 Vite 开发服跨域访问
app.use('/api/*', cors({
  origin: ['http://localhost:5173', 'tauri://localhost'],
  credentials: true,
}));

app.get('/api/health', (c) => c.json({ status: 'ok', engine: 'ClipMind Hono API' }));

// 挂载独立业务路由
app.route('/api/chat', chatRoute);
app.route('/api/oss-callback', ossCallbackRoute);
app.route('/api/upload-token', uploadTokenRoute);

serve({ fetch: app.fetch, port: 8787 }, (info) => {
  console.log(`🚀 Server listening on http://localhost:${info.port}`);
});
