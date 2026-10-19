import { test, expect } from "./fixture";
import { fakeIdentity } from "./fake-identity";

test.describe.configure({ mode: "parallel" });

test("Pending User registers a handle and keeps the updated profile on reload", async ({
  page,
  scenario,
}) => {
  const user = fakeIdentity({ state: "pending", emailVerified: false });
  await scenario({ identity: user, login: "success", registration: "success" });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(user.email, { exact: true })).toBeVisible();
  await page
    .getByRole("link", { name: "Register handle", exact: true })
    .click();
  await expect(page).toHaveURL("/register-handle");
  await page.getByLabel("Handle", { exact: true }).fill(user.handle);
  await page
    .getByRole("button", { name: "Register handle", exact: true })
    .click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(user.email, { exact: true })).toBeVisible();
  await expect(page.getByText(user.handle, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Register handle", exact: true }),
  ).toHaveCount(0);
  // Handle registration does not verify the User's email.
  await expect(
    page.getByRole("link", { name: "Verify email", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(user.email, { exact: true })).toBeVisible();
  await expect(page.getByText(user.handle, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Verify email", exact: true }),
  ).toBeVisible();
});

test("taken handle feedback leaves this User pending across profile reads", async ({
  page,
  scenario,
}) => {
  const user = fakeIdentity({ state: "pending", emailVerified: true });
  await scenario({ identity: user, login: "success", registration: "taken" });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(user.email, { exact: true })).toBeVisible();
  // Email verification does not register a handle.
  await expect(
    page.getByRole("link", { name: "Verify email", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Register handle", exact: true })
    .click();
  await expect(page).toHaveURL("/register-handle");
  await page.getByLabel("Handle", { exact: true }).fill(user.handle);
  await page
    .getByRole("button", { name: "Register handle", exact: true })
    .click();

  await expect(page.getByRole("alert")).toContainText(
    "This handle is taken. Choose another handle.",
  );
  await expect(page).toHaveURL("/register-handle");
  await expect(page.getByLabel("Handle", { exact: true })).toHaveValue(
    user.handle,
  );
  await page.goto("/");
  await expect(page.getByText(user.email, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Register handle", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(user.handle, { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(user.email, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Register handle", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Verify email", exact: true }),
  ).toHaveCount(0);
});
