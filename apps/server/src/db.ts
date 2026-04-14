import { createDbClient } from '@clipmind/db';
import { serverConfig } from './env';

// Server 侧掌控环境变量并完成注入，db 实例由此导出
export const db = createDbClient(serverConfig.DATABASE_URL);
