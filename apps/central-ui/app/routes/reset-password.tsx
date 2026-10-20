import { data, Form, Link } from "react-router";
import z from "zod";
import type { Route } from "./+types/reset-password";
import { Feedback, Field, Page, SubmitButton } from "~/components/ui";
import { PasswordSchema, trimPasswordInput } from "~/server/newtypes.server";
import { centralSession } from "~/server/sessions.server";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";

const TokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const invalidLink = "This password reset link is invalid or expired.";

export function meta() {
  return [
    { title: "Reset password · Ethoko Central" },
    { name: "referrer", content: "no-referrer" },
  ];
}

export function loader({ request }: Route.LoaderArgs) {
  const token = TokenSchema.safeParse(
    new URL(request.url).searchParams.get("token"),
  );
  // A page visit (including an email scanner) never validates or consumes a token.
  return data(
    { token: token.success ? token.data : null },
    {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const parsed = z
    .object({
      token: TokenSchema,
      password: PasswordSchema,
      confirmation: z.string(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const errors = z.treeifyError(parsed.error);
    return {
      errors: {
        password: errors.properties?.password?.errors.join(", "),
        reason: errors.properties?.token ? invalidLink : undefined,
      },
    };
  }
  if (parsed.data.password !== trimPasswordInput(parsed.data.confirmation))
    return { errors: { confirmation: "Passwords must match." } };
  try {
    const result = await ethokoCentralClient.resetPassword({
      token: parsed.data.token,
      password: parsed.data.password,
    });
    if (result.variant === "success") {
      const session = await centralSession.getSession(
        request.headers.get("Cookie"),
      );
      return data(
        { success: true, errors: undefined },
        {
          headers: {
            "Set-Cookie": await centralSession.destroySession(session),
            "Cache-Control": "no-store",
          },
        },
      );
    }
    return {
      errors: {
        reason:
          result.reason === "invalid-token"
            ? invalidLink
            : "We couldn’t reset your password. Try again.",
      },
    };
  } catch {
    return {
      errors: {
        reason: "The recovery service is unavailable. Try again in a moment.",
      },
    };
  }
}

export default function ResetPassword({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  if (actionData && "success" in actionData && actionData.success)
    return (
      <Page>
        <h1>Password reset</h1>
        <Feedback tone="success">
          Your password has been reset. Sign in with your new password.
        </Feedback>
        <Link to="/login">Sign in</Link>
      </Page>
    );
  return (
    <Page>
      <h1>Reset password</h1>
      <Feedback>
        {!loaderData.token ? invalidLink : actionData?.errors?.reason}
      </Feedback>
      {loaderData.token && (
        <Form method="post">
          <input type="hidden" name="token" value={loaderData.token} />
          <Field
            label="New password"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            error={actionData?.errors?.password}
          />
          <Field
            label="Confirm password"
            type="password"
            name="confirmation"
            autoComplete="new-password"
            required
            error={actionData?.errors?.confirmation}
          />
          <SubmitButton pendingLabel="Resetting…">Reset password</SubmitButton>
        </Form>
      )}
      <Link to="/forgot-password">Request a new reset link</Link>
    </Page>
  );
}
