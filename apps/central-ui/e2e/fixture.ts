import { test as base, expect } from "@playwright/test";
import { z } from "zod";
import { Identity, Observation, type ScenarioInput } from "./protocol";
import { apiUrl } from "./settings";

type Scenario = z.infer<typeof Identity> & {
  observe: () => Promise<z.infer<typeof Observation>>;
};

export const test = base.extend<{
  scenario: (outcome: ScenarioInput) => Promise<Scenario>;
}>({
  scenario: async ({ request }, use, testInfo) => {
    const owned: string[] = [];
    try {
      await use(async (outcome) => {
        const response = await request.post(`${apiUrl}/__test/scenarios`, {
          data: outcome,
        });
        expect(response.ok()).toBeTruthy();
        const identity = Identity.parse(await response.json());
        owned.push(identity.id);
        if (process.env.E2E_VERIFY_CONCURRENCY === "1") {
          const barrier = await request.post(`${apiUrl}/__test/concurrent`, {
            data: { id: identity.id },
          });
          expect(barrier.ok(), await barrier.text()).toBeTruthy();
        }
        return {
          ...identity,
          observe: async () => {
            const response = await request.get(
              `${apiUrl}/__test/scenarios/${identity.id}`,
            );
            expect(response.ok()).toBeTruthy();
            return Observation.parse(await response.json());
          },
        };
      });
    } finally {
      const violations: string[] = [];
      for (const id of owned) {
        const response = await request.delete(
          `${apiUrl}/__test/scenarios/${id}`,
        );
        expect(response.ok()).toBeTruthy();
        const observation = Observation.parse(await response.json());
        await testInfo.attach(`mock-api-${id}`, {
          body: JSON.stringify(observation, null, 2),
          contentType: "application/json",
        });
        violations.push(...observation.violations);
      }
      expect(violations, "Unexpected Central API traffic").toEqual([]);
    }
  },
});

export { expect } from "@playwright/test";
