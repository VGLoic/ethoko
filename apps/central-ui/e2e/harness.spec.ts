import { test, expect } from "./fixture";
import { fakeIdentity } from "./fake-identity";
import { apiUrl } from "./settings";

// These deliberately failing runs are launched only by check-harness.ts.
test("the harness rejects otherwise hidden failures", async ({
  page,
  request,
  scenario,
}) => {
  const probe = process.env.E2E_HARNESS_PROBE;
  if (probe === "unattributed") {
    const response = await request.get(`${apiUrl}/unknown-operation`);
    expect(response.status()).toBe(500);
    return; // Test passes; the suite audit must still fail.
  }
  const user = fakeIdentity();
  if (probe === "late") {
    const response = await request.post(`${apiUrl}/__test/scenarios`, {
      data: { identity: user, login: "success" },
    });
    expect(response.ok()).toBeTruthy();
    expect(await response.json()).toEqual(user);
    await request.delete(`${apiUrl}/__test/scenarios/${user.id}`);
    await request.post(`${apiUrl}/auth/login/email`, {
      data: { email: user.email, password: user.password },
    });
    return; // No fixture owns this retired scenario; only the suite audit catches it.
  }
  await scenario({ identity: user, login: "success" });
  if (probe === "cleanup") {
    expect(
      false,
      "deliberate assertion failure to verify fixture cleanup",
    ).toBe(true);
    return;
  }
  if (probe !== "absorbed") throw new Error(`Unknown harness probe: ${probe}`);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/");
  // Force an unexpected API response which the real logout action absorbs.
  await request.delete(`${apiUrl}/__test/scenarios/${user.id}`);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL("/login");
});
