import 'dotenv/config';
import { serverConfig } from './env';
import { runMigrations } from '@clipmind/db';
import { db } from './db';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import chatRoute from './routes/chat';
import ossCallbackRoute from './routes/oss-callback';
import asrCallbackRoute from './routes/asr-callback';
import uploadTokenRoute from './routes/upload-token';
import projectsRoute from './routes/projects';

const app = new Hono();

// 全局 CORS 策略
app.use('/api/*', cors({
  origin: serverConfig.CORS_ORIGIN,
  credentials: true,
}));

app.get('/api/health', (c) => c.json({ status: 'ok', engine: 'ClipMind Hono API' }));

// 挂载独立业务路由
app.route('/api/projects', projectsRoute);
import assetsRoute from './routes/assets';
import { startDanglingOssCleanupJob } from './jobs/cleanup-dangling-oss';

app.route('/api/chat', chatRoute);
app.route('/api/oss-callback', ossCallbackRoute);
app.route('/api/asr-callback', asrCallbackRoute);
app.route('/api/upload-token', uploadTokenRoute);
app.route('/api/assets', assetsRoute);

const startServer = async () => {
  try {
    console.log('🔄 [Database] Running migrations...');
    // 直接调用 db 包封装的方法，彻底解耦路径与 Drizzle 细节
    await runMigrations(serverConfig.DATABASE_URL);
    console.log('✅ [Database] Migrations completed.');

    // 启动定时清理任务防线
    startDanglingOssCleanupJob();

    serve({ fetch: app.fetch, port: serverConfig.PORT }, (info) => {
      console.log(`🚀 Server listening on port ${info.port} [CORS Allowed: ${serverConfig.CORS_ORIGIN.join(', ')}]`);
    });
  } catch (error) {
    console.error('❌ [Critical] Failed to run database migrations:', error);
    process.exit(1);
  }
};

startServer();
