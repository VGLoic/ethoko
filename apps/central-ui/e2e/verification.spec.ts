import { test, expect } from "./fixture";
import { fakeIdentity } from "./fake-identity";

test.describe.configure({ mode: "parallel" });

test("requesting another verification code displays email confirmation", async ({
  page,
  scenario,
}) => {
  const user = fakeIdentity({ emailVerified: false });
  const resend = await scenario({ identity: user, login: "success" });
  await page.goto(
    `/verify-email?${new URLSearchParams({ email: user.email })}`,
  );
  await expect(page.getByLabel("Verification code")).toBeEmpty();
  await page
    .getByRole("button", { name: "Resend verification email", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check your email", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "We sent a new verification code. Follow the link in your email to verify it.",
  );
  expect((await resend.observe()).requests).toEqual([
    "POST /auth/resend-verification-otp",
  ]);
});

test("expired verification code explains that a new code is needed", async ({
  page,
  scenario,
}) => {
  const user = fakeIdentity({ emailVerified: false });
  const verification = await scenario({
    identity: user,
    login: "success",
    verification: { code: "345678", outcome: "expired-code" },
  });
  await page.goto(
    `/verify-email?${new URLSearchParams({ email: user.email })}`,
  );
  await page.getByLabel("Verification code").fill("345678");
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "The provided code has expired. Request a new one.",
  );
  await expect(
    page.getByRole("heading", { name: "Verify email", exact: true }),
  ).toBeVisible();
  expect((await verification.observe()).requests).toEqual([
    "POST /auth/verify-email",
  ]);
});

test("invalid verification code shows corrective feedback", async ({
  page,
  scenario,
}) => {
  const user = fakeIdentity({ emailVerified: false });
  const verification = await scenario({
    identity: user,
    login: "success",
    verification: { code: "234567", outcome: "invalid-code" },
  });
  await page.goto(
    `/verify-email?${new URLSearchParams({ email: user.email })}`,
  );
  await page.getByLabel("Verification code").fill("234567");
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "The provided code is invalid. Request a new one.",
  );
  await expect(
    page.getByRole("heading", { name: "Verify email", exact: true }),
  ).toBeVisible();
  expect((await verification.observe()).requests).toEqual([
    "POST /auth/verify-email",
  ]);
});

test("query parameters prefill verification; submitting verifies the email", async ({
  page,
  scenario,
}) => {
  const user = fakeIdentity({ emailVerified: false });
  const verification = await scenario({
    identity: user,
    login: "success",
    verification: { code: "123456", outcome: "success" },
  });
  await page.goto(
    `/verify-email?${new URLSearchParams({ email: user.email, otp: "123456" })}`,
  );
  await expect(
    page.getByRole("heading", { name: "Verify email", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Verification code")).toHaveValue("123456");
  await expect(
    page.getByText(`Enter the code sent to ${user.email}.`),
  ).toBeVisible();
  expect((await verification.observe()).requests).toEqual([]);

  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Email verified", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Your email is verified. You can sign in to Ethoko Central.",
  );
  expect((await verification.observe()).requests).toEqual([
    "POST /auth/verify-email",
  ]);
});
