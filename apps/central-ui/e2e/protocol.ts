import { z } from "zod";

export const Identity = z.object({
  id: z.uuid(),
  email: z.email(),
  password: z.string(),
  handle: z.string(),
  token: z.string(),
  state: z.enum(["pending", "registered"]),
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Identity = z.infer<typeof Identity>;

export const ScenarioInput = z
  .object({
    identity: Identity,
    login: z.enum(["success", "invalid-credentials"]).default("success"),
    signup: z.literal("success").optional(),
    registration: z.enum(["success", "taken"]).default("success"),
  })
  .strict();
export type ScenarioInput = z.input<typeof ScenarioInput>;

export const Observation = z.object({
  active: z.boolean(),
  requests: z.array(z.string()),
  violations: z.array(z.string()),
});

export const Audit = z.object({
  scenarios: z.array(Identity.extend(Observation.shape)),
  violations: z.array(z.string()),
});
