import { test as base, expect } from "@playwright/test";
import { z } from "zod";
import { Observation, type ScenarioInput } from "./protocol";
import { apiUrl } from "./settings";

type Scenario = {
  observe: () => Promise<z.infer<typeof Observation>>;
};

export const test = base.extend<{
  scenario: (input: ScenarioInput) => Promise<Scenario>;
}>({
  scenario: async ({ request }, use, testInfo) => {
    const owned: string[] = [];
    try {
      await use(async (input) => {
        const response = await request.post(`${apiUrl}/__test/scenarios`, {
          data: input,
        });
        expect(response.ok(), await response.text()).toBeTruthy();
        const identity = input.identity;
        owned.push(identity.id);
        return {
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
