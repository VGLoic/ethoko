import { test, expect } from "./fixture";
import { fakeIdentity } from "./fake-identity";

test("login offers password recovery", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Forgot password" }),
  ).toBeVisible();
});

test("missing or malformed reset parameters offer a fresh recovery request", async ({
  page,
}) => {
  for (const path of ["/reset-password", "/reset-password?token=malformed"]) {
    await page.goto(path);
    await expect(
      page.getByText("This password reset link is invalid or expired."),
    ).toBeVisible();
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("link", { name: "Request a new reset link" }),
    ).toBeVisible();
  }
});

for (const password of [
  "  Ab1-éé  ",
  "Abcdef1_",
  "Abcdef1é",
  "Abcdef1 ",
  "Abcdef1😀",
  "\uFEFFAbcdef1",
  "Abcdef1\u0085",
]) {
  test(`shared password policy accepts Central-compatible input ${JSON.stringify(password)}`, async ({
    page,
    scenario,
  }) => {
    const user = fakeIdentity({
      password: password === "\uFEFFAbcdef1" ? password : password.trim(),
    });
    const login = await scenario({ identity: user });
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    if (password === "Abcdef1 " || password === "Abcdef1\u0085") {
      await expect(page.getByRole("alert").first()).toBeVisible();
      expect((await login.observe()).requests).toEqual([]);
    } else {
      await expect(page).toHaveURL("/");
    }
  });
}

test("confirmation and policy failures keep the link usable; success clears the browser session", async ({
  page,
  context,
  scenario,
}) => {
  const user = fakeIdentity();
  const token = "b".repeat(64);
  const recovery = await scenario({
    identity: user,
    recovery: { token, outcome: "success" },
  });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/");
  expect(
    (await context.cookies()).some((cookie) => cookie.name === "__session"),
  ).toBeTruthy();
  await page.goto(`/reset-password?token=${token}`);
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  expect((await recovery.observe()).requests).not.toContain(
    "POST /auth/reset-password",
  );
  await page.getByLabel("New password", { exact: true }).fill("weak");
  await page.getByLabel("Confirm password").fill("weak");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill("New-password1");
  await page.getByLabel("Confirm password").fill("Other-password1");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("Passwords must match.")).toBeVisible();
  expect((await recovery.observe()).requests).not.toContain(
    "POST /auth/reset-password",
  );
  await page.getByLabel("New password", { exact: true }).fill("New-password1");
  await page.getByLabel("Confirm password").fill("New-password1");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(
    page.getByRole("heading", { name: "Password reset" }),
  ).toBeVisible();
  expect(
    (await context.cookies()).some((cookie) => cookie.name === "__session"),
  ).toBeFalsy();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/login");
});

test("invalid links are checked only on submission and offer recovery", async ({
  page,
  scenario,
}) => {
  const token = "c".repeat(64);
  const recovery = await scenario({
    identity: fakeIdentity(),
    recovery: { token, outcome: "invalid-token" },
  });
  await page.goto(`/reset-password?token=${token}`);
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  expect((await recovery.observe()).requests).toEqual([]);
  await page.getByLabel("New password", { exact: true }).fill("New-password1");
  await page.getByLabel("Confirm password").fill("New-password1");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(
    page.getByText("This password reset link is invalid or expired."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Request a new reset link" }).click();
  await expect(page).toHaveURL("/forgot-password");
});

test("generic confirmation starts the configured resend countdown", async ({
  page,
  scenario,
}) => {
  const user = fakeIdentity();
  const recovery = await scenario({
    identity: user,
    recovery: { token: "a".repeat(64), outcome: "success", cooldownSeconds: 2 },
  });
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByText(
      "If this account is eligible for password recovery, you’ll receive an email.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Resend/ })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Resend reset link", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Resend reset link", exact: true })
    .click();
  await expect
    .poll(async () => (await recovery.observe()).requests.length)
    .toBe(2);
});
