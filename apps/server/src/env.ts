import { z } from 'zod';

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(8787),
  CORS_ORIGIN: z.string()
    .transform((val) => val.split(',').map((origin) => origin.trim()))
    .refine((origins) => origins.length > 0, {
      message: "CORS_ORIGIN 不能包含空数组",
    }),
  DATABASE_URL: z.string().url({ message: "DATABASE_URL 必须是有效的连接字符串" }),
  ALIYUN_ACCESS_KEY_ID: z.string().min(1, "缺少 ALIYUN_ACCESS_KEY_ID"),
  ALIYUN_ACCESS_KEY_SECRET: z.string().min(1, "缺少 ALIYUN_ACCESS_KEY_SECRET"),
  ALIYUN_ASR_APPKEY: z.string().min(1, "缺少 ALIYUN_ASR_APPKEY"),
  PUBLIC_WEBHOOK_DOMAIN: z.string().url({ message: "PUBLIC_WEBHOOK_DOMAIN 必须是合法的 URL" }),
});

export const serverConfig = serverEnvSchema.parse(process.env);
