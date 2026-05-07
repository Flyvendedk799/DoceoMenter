import { z } from "zod";

const envSchema = z.object({
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  RUN_MODE: z.enum(["in-process", "container"]).default("in-process"),
  ENABLE_DOCKER_IN_DOCKER: z
    .string()
    .default("false")
    .transform((s) => s === "true"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_PRIMARY: z.string().default("claude-opus-4-7"),
  ANTHROPIC_MODEL_FALLBACK: z.string().default("claude-sonnet-4-6"),
  MAX_REPO_MB: z.coerce.number().default(500),
  MAX_RUN_SECONDS: z.coerce.number().default(600),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),
  DATA_ROOT: z.string().default("data/runs"),
});

export type WorkerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return envSchema.parse(env);
}
