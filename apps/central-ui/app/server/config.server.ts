import { z } from "zod";
const EnvSchema = z.object({
  ETHOKO_CENTRAL_URL: z.url(),
  NODE_ENV: z.literal(["development", "production", "test"]),
  SESSION_SECRET: z.string(),
});

export const config = EnvSchema.parse(process.env);
