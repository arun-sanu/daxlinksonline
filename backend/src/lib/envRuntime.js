import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.string().optional(),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(24),
    VAULT_ADDR: z.string().url().optional(),
    VAULT_TOKEN: z.string().optional(),
    KMS_PROVIDER: z.enum(['aws', 'gcp']).optional(),
    KMS_KEY_ID: z.string().optional(),
    MAIL_FROM: z.string().email().optional(),
    MAIL_HOST: z.string().optional(),
    MAIL_USER: z.string().optional(),
    MAIL_PASS: z.string().optional()
  })
  .superRefine((env, ctx) => {
    const vaultOk = !!(env.VAULT_ADDR && env.VAULT_TOKEN);
    const kmsOk = !!(env.KMS_PROVIDER && env.KMS_KEY_ID);
    if (!vaultOk && !kmsOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either VAULT_ADDR & VAULT_TOKEN or KMS_PROVIDER & KMS_KEY_ID must be set'
      });
    }
  });

export function loadEnvOrExit() {
  const res = EnvSchema.safeParse(process.env);
  if (!res.success) {
    console.error('\n[env] Invalid/missing environment variables:');
    for (const issue of res.error.issues) {
      console.error(` - ${issue.message}`);
    }
    process.exit(1);
  }
  // Return parsed env for optional typed-like usage
  return res.data;
}

