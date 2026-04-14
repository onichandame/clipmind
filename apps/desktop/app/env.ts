import { z } from 'zod';

const clientEnvSchema = z.object({
  VITE_API_BASE_URL: z.string().url("VITE_API_BASE_URL 必须是合法的 URL，例如 http://localhost:8787"),
});

// 在模块加载的第一时间触发校验，若失败应用将直接白屏阻断，防止幽灵请求
export const env = clientEnvSchema.parse(import.meta.env);
