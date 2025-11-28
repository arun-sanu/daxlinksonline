import { z } from 'zod';

const base64Key = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/, 'KMS_KEY must be a 32-byte base64 string');

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.string().optional(),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(24),
    WEBHOOK_BASE_DOMAIN: z.string().min(3),
    CORS_ORIGINS: z.string().optional(),
    REDIS_URL: z.string().url().optional(),
    KMS_KEY: base64Key.optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().optional(),
    SMTP_USERNAME: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().email().optional(),
    APP_BASE_URL: z.string().url().optional(),
    FEATURE_NOTIFICATIONS: z.enum(['true', 'false']).default('true')
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.KMS_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'KMS_KEY is required in production (32-byte base64)'
      });
    }

    const smtpValues = [env.SMTP_HOST, env.SMTP_PORT, env.SMTP_USERNAME, env.SMTP_PASSWORD, env.EMAIL_FROM];
    const smtpConfigured = smtpValues.some(Boolean);
    if (smtpConfigured && smtpValues.some((v) => !v)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SMTP_HOST/SMTP_PORT/SMTP_USERNAME/SMTP_PASSWORD/EMAIL_FROM must all be set together'
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;
