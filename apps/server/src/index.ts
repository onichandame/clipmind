import 'dotenv/config';
import { db } from '@clipmind/db';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import path from 'path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import chatRoute from './routes/chat';
import messagesRoute from './routes/messages';
import ossCallbackRoute from './routes/oss-callback';
import uploadTokenRoute from './routes/upload-token';
import projectsRoute from './routes/projects';

const app = new Hono();

// 全局 CORS 策略
app.use('/api/*', cors({
  origin: ['http://localhost:5173', 'tauri://localhost'],
  credentials: true,
}));

app.get('/api/health', (c) => c.json({ status: 'ok', engine: 'ClipMind Hono API' }));

// 挂载独立业务路由
app.route('/api/projects', projectsRoute);
app.route('/api/projects', messagesRoute);
app.route('/api/chat', chatRoute);
app.route('/api/oss-callback', ossCallbackRoute);
app.route('/api/upload-token', uploadTokenRoute);

const startServer = async () => {
  try {
    console.log('🔄 [Database] Running migrations...');
    // 精准定位到绝对物理路径
    const migrationPath = path.resolve(__dirname, '../../../packages/db/src/migrations');
    await migrate(db, { migrationsFolder: migrationPath });
    console.log('✅ [Database] Migrations completed.');

    serve({ fetch: app.fetch, port: 8787 }, (info) => {
      console.log(`🚀 Server listening on http://localhost:${info.port}`);
    });
  } catch (error) {
    console.error('❌ [Critical] Failed to run database migrations:', error);
    process.exit(1);
  }
};

startServer();
