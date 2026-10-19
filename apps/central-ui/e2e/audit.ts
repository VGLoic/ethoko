import { mkdir, writeFile } from "node:fs/promises";
import { Audit } from "./protocol";
import { apiUrl } from "./settings";

export default async function audit() {
  const response = await fetch(`${apiUrl}/__test/audit`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`Mock API audit failed: ${response.status}`);
  const audit = Audit.parse(await response.json());
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/mock-api.json", JSON.stringify(audit, null, 2));
  const active = audit.scenarios.filter((scenario) => scenario.active);
  if (audit.violations.length || active.length) {
    throw new Error(
      `Mock API audit failed:\n${audit.violations.join("\n")}\nUnretired scenarios: ${active.map((scenario) => scenario.id).join(", ")}`,
    );
  }
}
