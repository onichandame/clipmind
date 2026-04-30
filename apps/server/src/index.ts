import 'dotenv/config';
import { serverConfig } from './env';
import { runSystemMigrations } from './migrator';
import { db } from './db';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import chatRoute from './routes/chat';
import ossCallbackRoute from './routes/oss-callback';
import asrCallbackRoute from './routes/asr-callback';
import uploadTokenRoute from './routes/upload-token';
import projectsRoute from './routes/projects';
import authRoute from './routes/auth';

const app = new Hono();

// 全局 CORS 策略
app.use('/api/*', cors({
  origin: serverConfig.CORS_ORIGIN,
  credentials: true,
}));

app.get('/api/health', (c) => c.json({ status: 'ok', engine: 'ClipMind Hono API' }));

// Auth 路由（无需 requireAuth 守卫，自身处理校验）
app.route('/api/auth', authRoute);

// 挂载独立业务路由
app.route('/api/projects', projectsRoute);
import assetsRoute from './routes/assets';
import hotspotsAdminRoute from './routes/hotspots-admin';
import { startDanglingOssCleanupJob } from './jobs/cleanup-dangling-oss';
import { startHotspotsPipeline } from './jobs/hotspots-pipeline';
import { startMemoryCompactionJob } from './jobs/memory-compaction';

app.route('/api/chat', chatRoute);
app.route('/api/oss-callback', ossCallbackRoute);
app.route('/api/asr-callback', asrCallbackRoute);
app.route('/api/upload-token', uploadTokenRoute);
app.route('/api/assets', assetsRoute);
app.route('/api/hotspots-admin', hotspotsAdminRoute);

const startServer = async () => {
  try {
    await runSystemMigrations();

    // 启动定时清理任务防线
    startDanglingOssCleanupJob();
    // 启动热点库采集管道
    startHotspotsPipeline();
    // 启动用户长期记忆压缩任务（每天 03:00）
    startMemoryCompactionJob();

    serve({ fetch: app.fetch, port: serverConfig.PORT }, (info) => {
      console.log(`🚀 Server listening on port ${info.port} [CORS Allowed: ${serverConfig.CORS_ORIGIN.join(', ')}]`);
    });
  } catch (error) {
    console.error('❌ [Critical] Failed to run database migrations:', error);
    process.exit(1);
  }
};

startServer();
