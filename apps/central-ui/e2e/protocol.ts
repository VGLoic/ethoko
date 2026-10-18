import { z } from "zod";

export const ScenarioInput = z
  .object({
    login: z.enum(["success", "invalid-credentials"]),
  })
  .strict();
export type ScenarioInput = z.infer<typeof ScenarioInput>;

export const Identity = z.object({
  id: z.uuid(),
  email: z.email(),
  password: z.string(),
  handle: z.string(),
  token: z.string(),
});

export const Observation = z.object({
  active: z.boolean(),
  requests: z.array(z.string()),
  violations: z.array(z.string()),
});

export const Audit = z.object({
  scenarios: z.array(Identity.extend(Observation.shape)),
  violations: z.array(z.string()),
});
