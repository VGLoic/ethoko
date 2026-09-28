import { z } from "zod";
const EnvSchema = z.object({
  ETHOKO_CENTRAL_URL: z.url(),
  CENTRAL_UI_BFF_SHARED_SECRET: z.string().min(1),
  NODE_ENV: z.literal(["development", "production", "test"]),
  SESSION_SECRET: z.string(),
});

export const config = EnvSchema.parse(process.env);
