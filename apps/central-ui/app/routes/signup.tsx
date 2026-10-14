import { Form } from "react-router";
import type { Route } from "./+types/signup";
import z from "zod";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";
import { PasswordSchema } from "~/server/newtypes.server";

export function meta() {
  return [
    { title: "Sign Up" },
    { name: "description", content: "Sign up to Ethoko Central!" },
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
            email: "An account with this email already exist",
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
        reason: "An error occurred during signup.",
      },
    };
  }
}

export default function Signup({ actionData }: Route.ComponentProps) {
  if (actionData?.success) {
    return (
      <main>
        <p>Sign up successful!</p>
      </main>
    );
  }

  return (
    <main className="flex flex-col pt-16 pb-4 px-8 gap-8">
      <h1 className="flex justify-center">Sign Up to Ethoko Central</h1>
      <Form method="post" className="flex flex-col gap-4">
        <label>
          Email:
          <input type="email" name="email" required className="border p-2" />
          {actionData?.errors?.email ? (
            <p className="text-red-500">{actionData.errors.email}</p>
          ) : null}
        </label>
        <label>
          Password:
          <input
            type="password"
            name="password"
            required
            className="border p-2"
          />
          {actionData?.errors?.password ? (
            <p className="text-red-500">{actionData.errors.password}</p>
          ) : null}
        </label>
        <label>
          Password confirmation:
          <input
            type="password"
            name="passwordConfirmation"
            required
            className="border p-2"
          />
          {actionData?.errors?.passwordConfirmation ? (
            <p className="text-red-500">
              {actionData.errors.passwordConfirmation}
            </p>
          ) : null}
        </label>
        {actionData?.errors?.reason ? (
          <p className="text-red-500">{actionData.errors.reason}</p>
        ) : null}
        <button type="submit">Sign Up</button>
      </Form>
    </main>
  );
}
