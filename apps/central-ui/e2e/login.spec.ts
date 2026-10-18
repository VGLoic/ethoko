import { test, expect } from "./fixture";

test("email login displays this User's home; logout protects it again", async ({
  page,
  scenario,
}) => {
  const user = await scenario({ login: "success" });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(user.email, { exact: true })).toBeVisible();
  await expect(page.getByText(user.handle, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(user.email, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL("/login");
  await page.goto("/");
  await expect(page).toHaveURL("/login");
  await expect(
    page.getByRole("heading", { name: "Sign in to Ethoko Central" }),
  ).toBeVisible();
  const observations = await user.observe();
  expect(observations.requests).toEqual(
    expect.arrayContaining([
      "POST /auth/login/email",
      "GET /auth/me",
      "POST /auth/logout",
    ]),
  );
});

test("invalid email credentials show corrective feedback without a session", async ({
  page,
  scenario,
}) => {
  const user = await scenario({ login: "invalid-credentials" });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText(
    "We couldn’t sign you in. Check your email and password, then try again.",
  );
  await expect(page).toHaveURL("/login");
  await page.goto("/");
  await expect(page).toHaveURL("/login");
  expect((await user.observe()).requests).toEqual(["POST /auth/login/email"]);
});
