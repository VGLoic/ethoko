import { useEffect, useState } from "react";
import { Form, Link } from "react-router";
import z from "zod";
import type { Route } from "./+types/forgot-password";
import { Feedback, Field, Page, SubmitButton } from "~/components/ui";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";

export function meta() {
  return [{ title: "Forgot password · Ethoko Central" }];
}

export async function action({ request }: Route.ActionArgs): Promise<{
  error?: string;
  message?: string;
  confirmedAt?: number;
  cooldownSeconds?: number;
}> {
  const form = await request.formData();
  const email = z.email().safeParse(form.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };
  try {
    const result = await ethokoCentralClient.forgotPassword({
      email: email.data,
    });
    if (result.variant === "success")
      return { ...result.data, confirmedAt: Date.now() };
  } catch {
    // Do not log submitted email addresses or credentials.
  }
  return {
    error: "The recovery service is unavailable. Try again in a moment.",
  };
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!actionData?.confirmedAt) return;
    const until =
      actionData.confirmedAt + (actionData.cooldownSeconds ?? 0) * 1000;
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [actionData]);
  return (
    <Page>
      <h1>Forgot password</h1>
      <Feedback tone="success">{actionData?.message}</Feedback>
      <Form method="post">
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={actionData?.error}
        />
        <SubmitButton pendingLabel="Sending…" disabled={remaining > 0}>
          {actionData?.message
            ? remaining > 0
              ? `Resend in ${remaining}s`
              : "Resend reset link"
            : "Send reset link"}
        </SubmitButton>
      </Form>
      <Link to="/login">Return to sign in</Link>
    </Page>
  );
}
