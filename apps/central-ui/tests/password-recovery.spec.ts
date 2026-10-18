import { expect, test } from "@playwright/test";

test("login entry, generic confirmation and configured resend countdown", async ({
  page,
}) => {
  // Even forged source-IP headers must be overwritten by the UI's socket adapter.
  await page.setExtraHTTPHeaders({
    "x-ethoko-source-ip": "203.0.113.10",
    "x-forwarded-for": "203.0.113.10",
  });
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Forgot password", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Email").fill("unknown@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByText(
      "If this account is eligible for password recovery, you’ll receive an email.",
    ),
  ).toBeVisible();
  const resend = page.getByRole("button", { name: /Resend/ });
  await expect(resend).toBeDisabled();
  await expect(resend).toBeEnabled({ timeout: 5000 });
  await resend.click();
  await expect(resend).toBeDisabled();
});

test("confirmation and backend validation do not consume a link; success clears cookie without signing in", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "__session",
      value: "old-session-cookie",
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await page.goto("/reset-password?token=valid-browser-reset");
  await page.reload();
  await page
    .getByLabel("New password", { exact: true })
    .fill("RejectedPassword1!");
  await page.getByLabel("Confirm new password").fill("Different1!");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();
  await page.getByLabel("Confirm new password").fill("RejectedPassword1!");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("alert")).toContainText("at least 8 UTF-8 bytes");
  // Central, not the UI's narrower signup regex, owns password validation.
  await page.getByLabel("New password", { exact: true }).fill("  Aa1ééé  ");
  await page.getByLabel("Confirm new password").fill("  Aa1ééé  ");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("Your password has been reset.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  expect(
    (await context.cookies()).some((cookie) => cookie.name === "__session"),
  ).toBe(false);
  await page.getByRole("link", { name: "Log in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Log In to Ethoko Central" }),
  ).toBeVisible();
  await page
    .getByLabel("Email:", { exact: true })
    .fill("recovered@example.com");
  await page.getByLabel("Password:", { exact: true }).fill("Aa1ééé");
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(
    page.getByText("recovered@example.com", { exact: true }),
  ).toBeVisible();
  await page.goto("/reset-password?token=valid-browser-reset");
  await expect(
    page.getByText("This reset link is invalid or expired."),
  ).toBeVisible();
});

test("unknown and missing links offer recovery", async ({ page }) => {
  for (const url of ["/reset-password?token=unknown", "/reset-password"]) {
    await page.goto(url);
    await expect(
      page.getByText("This reset link is invalid or expired."),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Request another link" }),
    ).toHaveAttribute("href", "/forgot-password");
  }
});
