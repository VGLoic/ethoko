import { Form, Link, data, useNavigation } from "react-router";
import { useEffect, useState } from "react";
import z from "zod";
import type { Route } from "./+types/forgot-password";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";
import { recoveryClientIp, recoveryFailure } from "~/server/recovery.server";

export function meta() {
  return [{ title: "Forgot password" }];
}
export function headers() {
  return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  if (!z.email().safeParse(email).success)
    return data(
      { email, error: "Enter a valid email address.", confirmation: null },
      { status: 422 },
    );
  try {
    const result = await ethokoCentralClient.forgotPassword(
      email,
      recoveryClientIp(request),
    );
    if (result.variant !== "success")
      return data(
        { email, error: "Enter a valid email address.", confirmation: null },
        { status: 422 },
      );
    return {
      email,
      error: null,
      confirmation: {
        message: result.data.message,
        seconds: result.data.cooldownSeconds,
        until: Date.now() + result.data.cooldownSeconds * 1000,
      },
    };
  } catch (error) {
    const failure = recoveryFailure(error);
    return data(
      { email, error: failure.error, confirmation: null },
      { status: failure.status },
    );
  }
}

function ResendButton({
  seconds,
  until,
  busy,
}: {
  seconds: number;
  until: number;
  busy: boolean;
}) {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => {
    const timer = setInterval(
      () => setRemaining(Math.max(0, Math.ceil((until - Date.now()) / 1000))),
      250,
    );
    return () => clearInterval(timer);
  }, [until]);
  return (
    <button type="submit" disabled={busy || remaining > 0}>
      {remaining > 0 ? `Resend in ${remaining}s` : "Resend reset link"}
    </button>
  );
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return (
    <main className="flex flex-col pt-16 pb-4 px-8 gap-8">
      <h1>Forgot password</h1>
      {actionData?.confirmation && (
        <p role="status">{actionData.confirmation.message}</p>
      )}
      {actionData?.error && <p role="alert">{actionData.error}</p>}
      <Form method="post" className="flex flex-col gap-4">
        <label>
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            defaultValue={actionData?.email}
            readOnly={!!actionData?.confirmation}
            className="border p-2"
          />
        </label>
        {actionData?.confirmation ? (
          <ResendButton
            key={actionData.confirmation.until}
            {...actionData.confirmation}
            busy={busy}
          />
        ) : (
          <button type="submit" disabled={busy}>
            Send reset link
          </button>
        )}
      </Form>
      <Link to="/login">Log in</Link>
    </main>
  );
}
