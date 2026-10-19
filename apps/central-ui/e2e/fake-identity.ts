import { randomUUID } from "node:crypto";
import type { Identity } from "./protocol";

export function fakeIdentity(overrides: Partial<Identity> = {}): Identity {
  const id = randomUUID();
  return {
    id,
    email: `user-${id}@example.com`,
    password: `Pw1!${randomUUID()}`,
    handle: `user-${id.slice(0, 18)}`,
    token: randomUUID(),
    state: "registered",
    emailVerified: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
