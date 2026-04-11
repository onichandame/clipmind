import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './src/migrations', // 对齐到你真实的历史目录
  dialect: 'mysql', 
});
