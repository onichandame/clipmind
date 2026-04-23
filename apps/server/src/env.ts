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
  OPENAI_API_KEY: z.string().min(1, "缺少 OPENAI_API_KEY"),
  OPENAI_BASE_URL: z.string().url({ message: "OPENAI_BASE_URL 必须是合法的 URL" }),
  QDRANT_URL: z.string().url({ message: "QDRANT_URL 必须是合法的 URL" }),
  QDRANT_API_KEY: z.string().optional(),
  SEARCHAPI_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
  HOTSPOTS_CRON_SCHEDULE: z.string().default('0 5 * * *'),
  HOTSPOTS_MIN_CORPUS: z.coerce.number().int().min(1).default(5),
  HOTSPOTS_LLM_MODEL: z.string().default('gpt-4.1'),
  HOTSPOTS_MAX_ITEMS: z.coerce.number().int().min(1).default(20),
});

export const serverConfig = serverEnvSchema.parse(process.env);
