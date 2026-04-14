import { z } from 'zod';

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(8787),
  CORS_ORIGIN: z.string()
    .transform((val) => val.split(',').map((origin) => origin.trim()))
    .refine((origins) => origins.length > 0, {
      message: "CORS_ORIGIN 不能包含空数组",
    }),
});

export const serverConfig = serverEnvSchema.parse(process.env);
