import { Form } from "react-router";
import type { Route } from "./+types/signup";
import z from "zod";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";
import { PasswordSchema } from "~/server/newtypes.server";
import { Feedback, Field, Page, SubmitButton } from "~/components/ui";

export function meta() {
  return [
    { title: "Sign up · Ethoko Central" },
    { name: "description", content: "Sign up to Ethoko Central." },
  ];
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();

  const signupRequestParsingResult = z
    .object({
      email: z.email(),
      password: PasswordSchema,
      passwordConfirmation: PasswordSchema,
    })
    .refine((data) => data.password === data.passwordConfirmation, {
      message: "Passwords do not match",
      path: ["passwordConfirmation"],
    })
    .safeParse(Object.fromEntries(formData));

  if (!signupRequestParsingResult.success) {
    const errors = z.treeifyError(signupRequestParsingResult.error);
    return {
      success: false as const,
      errors: {
        reason: null,
        email: errors.properties?.email?.errors.join(", "),
        password: errors.properties?.password?.errors.join(", "),
        passwordConfirmation:
          errors.properties?.passwordConfirmation?.errors.join(", "),
      },
    };
  }

  try {
    const signupResult = await ethokoCentralClient.signup({
      email: signupRequestParsingResult.data.email,
      password: signupRequestParsingResult.data.password,
    });

    if (signupResult.variant === "success") {
      return { success: true as const, user: signupResult.data };
    }
    if (signupResult.variant === "unprocessable-entity") {
      if (signupResult.reason === "email-already-registered") {
        return {
          success: false as const,
          errors: {
            reason: null,
            email:
              "This email is already registered. Sign in with your email and password.",
          },
        };
      }
      if (signupResult.reason === "unknown") {
        throw signupResult.reason;
      }
      throw new Error(`unknown reason ${signupResult.reason satisfies never}`);
    }
    throw new Error(`Unknown variant ${signupResult satisfies never}`);
  } catch (error) {
    console.error("Signup error:", error);
    return {
      success: false as const,
      errors: {
        reason: "We couldn’t complete sign-up. Try again in a moment.",
      },
    };
  }
}

export default function Signup({ actionData }: Route.ComponentProps) {
  if (actionData?.success) {
    return (
      <Page>
        <h1>Check your email</h1>
        <Feedback tone="success">
          You’re signed up. Check your email for a verification code.
        </Feedback>
      </Page>
    );
  }

  return (
    <Page>
      <h1>Sign up to Ethoko Central</h1>
      <Form method="post">
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          error={actionData?.errors?.email}
        />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          error={actionData?.errors?.password}
        />
        <Field
          label="Confirm password"
          type="password"
          name="passwordConfirmation"
          autoComplete="new-password"
          required
          error={actionData?.errors?.passwordConfirmation}
        />
        <Feedback>{actionData?.errors?.reason}</Feedback>
        <SubmitButton pendingLabel="Signing up…">Sign up</SubmitButton>
      </Form>
    </Page>
  );
}
