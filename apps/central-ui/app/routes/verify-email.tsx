import z from "zod";
import type { Route } from "./+types/verify-email";
import { OtpSchema } from "~/server/newtypes.server";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";
import { Form } from "react-router";
import { Feedback, Field, Page, SubmitButton } from "~/components/ui";

export function meta() {
  return [{ title: "Verify email · Ethoko Central" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { searchParams } = new URL(request.url);
  const otp = searchParams.get("otp");
  const email = searchParams.get("email");

  const emailParsingResult = z.email().safeParse(email);
  if (!emailParsingResult.success) {
    throw new Response("Not found", { status: 404 });
  }
  const otpParsingResult = OtpSchema.safeParse(otp);

  return {
    email: emailParsingResult.data,
    otp: otpParsingResult.success ? otpParsingResult.data : null,
  };
}

const VERIFY_EMAIL_INTENT = "verify-email";
const RESEND_VERIFICATION_INTENT = "resend-verification";

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === VERIFY_EMAIL_INTENT) {
    const parsingResult = z
      .object({
        email: z.email(),
        otp: OtpSchema,
      })
      .safeParse(Object.fromEntries(formData));
    if (!parsingResult.success) {
      const parsingErrors = z.treeifyError(parsingResult.error);
      return {
        intent: VERIFY_EMAIL_INTENT,
        success: false,
        errors: {
          email: parsingErrors.properties?.email?.errors?.join(", "),
          otp: parsingErrors.properties?.otp?.errors?.join(", "),
        },
      };
    }

    try {
      const verifyEmailResult = await ethokoCentralClient.verifyEmail({
        otp: parsingResult.data.otp,
        email: parsingResult.data.email,
      });
      if (verifyEmailResult.variant === "success") {
        return {
          intent: VERIFY_EMAIL_INTENT,
          success: true,
        };
      }
      if (verifyEmailResult.variant === "unprocessable-entity") {
        const errorReason =
          verifyEmailResult.reason === "email-already-verified"
            ? "Your email is already verified. You can sign in."
            : verifyEmailResult.reason === "invalid-otp"
              ? "The provided code is invalid. Request a new one."
              : verifyEmailResult.reason === "expired-otp"
                ? "The provided code has expired. Request a new one."
                : verifyEmailResult.reason === "unknown"
                  ? "We couldn’t verify your email. Try again in a moment."
                  : `Unknown reason ${verifyEmailResult.reason satisfies never}`;
        return {
          intent: VERIFY_EMAIL_INTENT,
          success: false,
          errors: {
            reason: errorReason,
          },
        };
      }
      throw new Error(`Unknown variant ${verifyEmailResult satisfies never}`);
    } catch (error) {
      console.error("Email verification error:", error);
      return {
        intent: VERIFY_EMAIL_INTENT,
        success: false,
        errors: {
          reason:
            "The verification service is unavailable. Try again in a moment.",
        },
      };
    }
  }

  if (intent === RESEND_VERIFICATION_INTENT) {
    const parsingResult = z
      .object({
        email: z.email(),
      })
      .safeParse(Object.fromEntries(formData));
    if (!parsingResult.success) {
      const parsingErrors = z.treeifyError(parsingResult.error);
      return {
        intent: RESEND_VERIFICATION_INTENT,
        success: false,
        errors: {
          email: parsingErrors.properties?.email?.errors?.join(", ") ?? null,
        },
      };
    }
    try {
      const resendResult = await ethokoCentralClient.resendVerificationEmail({
        email: parsingResult.data.email,
      });
      if (resendResult.variant === "success") {
        return {
          intent: RESEND_VERIFICATION_INTENT,
          success: true,
        };
      }
      if (resendResult.variant === "unprocessable-entity") {
        const errorReason =
          resendResult.reason === "email-already-verified"
            ? "Your email is already verified. You can sign in."
            : resendResult.reason === "cooldown-period-not-elapsed"
              ? "A code was requested recently. Wait a moment, then try again."
              : resendResult.reason === "unknown"
                ? "We couldn’t send a new code. Try again in a moment."
                : `Unknown reason ${resendResult.reason satisfies never}`;
        return {
          intent: RESEND_VERIFICATION_INTENT,
          success: false,
          errors: {
            reason: errorReason,
          },
        };
      }
      throw new Error(`Unknown variant ${resendResult satisfies never}`);
    } catch (error) {
      console.error("Resend verification email error:", error);
      return {
        intent: RESEND_VERIFICATION_INTENT,
        success: false,
        errors: {
          reason:
            "The email service is unavailable. Try requesting a new code in a moment.",
        },
      };
    }
  }
}

export default function VerifyEmail({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  if (actionData?.success) {
    if (actionData?.intent === VERIFY_EMAIL_INTENT) {
      return (
        <Page>
          <h1>Email verified</h1>
          <Feedback tone="success">
            Your email is verified. You can sign in to Ethoko Central.
          </Feedback>
        </Page>
      );
    }
    if (actionData?.intent === RESEND_VERIFICATION_INTENT) {
      return (
        <Page>
          <h1>Check your email</h1>
          <Feedback tone="success">
            We sent a new verification code. Follow the link in your email to
            verify it.
          </Feedback>
        </Page>
      );
    }
  }
  return (
    <Page>
      <h1>Verify email</h1>
      <Form method="post">
        <input type="hidden" name="email" value={loaderData.email} />
        <Feedback>{actionData?.errors?.email}</Feedback>
        <input type="hidden" name="intent" value={VERIFY_EMAIL_INTENT} />
        <Field
          label="Verification code"
          name="otp"
          autoComplete="one-time-code"
          className="identifier"
          defaultValue={loaderData.otp ?? ""}
          error={actionData?.errors?.otp}
          hint={`Enter the code sent to ${loaderData.email}.`}
        />
        {actionData?.intent === VERIFY_EMAIL_INTENT &&
          actionData?.errors?.reason && (
            <Feedback>{actionData.errors.reason}</Feedback>
          )}
        <SubmitButton intent={VERIFY_EMAIL_INTENT} pendingLabel="Verifying…">
          Verify email
        </SubmitButton>
      </Form>
      <Form method="post">
        {actionData?.intent === RESEND_VERIFICATION_INTENT &&
          actionData?.errors?.reason && (
            <Feedback>{actionData.errors.reason}</Feedback>
          )}
        <input type="hidden" name="email" value={loaderData.email} />
        <input type="hidden" name="intent" value={RESEND_VERIFICATION_INTENT} />
        <SubmitButton
          intent={RESEND_VERIFICATION_INTENT}
          secondary
          pendingLabel="Sending…"
        >
          Resend verification email
        </SubmitButton>
      </Form>
    </Page>
  );
}
