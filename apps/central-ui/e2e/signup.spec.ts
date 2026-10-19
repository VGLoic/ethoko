import { test, expect } from "./fixture";
import { fakeIdentity } from "./fake-identity";

test.describe.configure({ mode: "parallel" });

test("signup displays email confirmation without signing the User in", async ({
  page,
  scenario,
}) => {
  const user = fakeIdentity({ emailVerified: false });
  const signup = await scenario({ identity: user, signup: "success" });
  await page.goto("/signup");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill(user.password);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Check your email", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "You’re signed up. Check your email for a verification code.",
  );
  await expect(page).toHaveURL("/signup");
  await page.goto("/");
  await expect(page).toHaveURL("/login");
  expect((await signup.observe()).requests).toEqual([
    "POST /auth/signup/email",
  ]);
});

test("mismatched password confirmation is rejected without a signup API request", async ({
  page,
  scenario,
}) => {
  const user = fakeIdentity();
  // Signup is deliberately not configured: any API call is unexpected.
  const signup = await scenario({ identity: user });
  await page.goto("/signup");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill(fakeIdentity().password);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText("Passwords do not match");
  await expect(
    page.getByLabel("Confirm password", { exact: true }),
  ).toHaveAccessibleDescription("Error: Passwords do not match");
  await expect(page).toHaveURL("/signup");
  expect((await signup.observe()).requests).toEqual([]);
});
