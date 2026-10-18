import { Form, redirect } from "react-router";
import z from "zod";
import type { Route } from "./+types/register-handle";
import { getSessionTokenOrRedirect } from "~/server/auth.server";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";
import { HandleSchema } from "~/server/newtypes.server";
import { Feedback, Field, Page, SubmitButton } from "~/components/ui";

export function meta() {
  return [
    { title: "Register handle · Ethoko Central" },
    { name: "description", content: "Register your Ethoko Central handle." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { token } = await getSessionTokenOrRedirect(request.headers);
  const user = await ethokoCentralClient.me({ token });

  return { user };
}

export async function action({ request }: Route.ActionArgs) {
  const { token } = await getSessionTokenOrRedirect(request.headers);
  const formData = await request.formData();

  const parsingResult = z
    .object({
      handle: HandleSchema,
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsingResult.success) {
    const errors = z.treeifyError(parsingResult.error);
    return {
      success: false as const,
      errors: {
        handle: errors.properties?.handle?.errors.join(", "),
      },
    };
  }

  try {
    const registerHandleResult = await ethokoCentralClient.registerHandle({
      token,
      handle: parsingResult.data.handle,
    });

    if (registerHandleResult.variant === "success") {
      return redirect("/");
    }

    if (registerHandleResult.variant === "unprocessable-entity") {
      if (registerHandleResult.reason === "handle-already-registered") {
        return {
          success: false as const,
          errors: {
            handle: "This handle is taken. Choose another handle.",
          },
        };
      }

      if (registerHandleResult.reason === "invalid-handle") {
        return {
          success: false as const,
          errors: {
            handle: "This handle is not allowed. Choose another handle.",
          },
        };
      }

      if (registerHandleResult.reason === "already-registered") {
        return redirect("/");
      }

      if (registerHandleResult.reason === "unknown") {
        throw registerHandleResult.reason;
      }

      throw new Error(
        `Unknown reason ${registerHandleResult.reason satisfies never}`,
      );
    }

    throw new Error(`Unknown variant ${registerHandleResult satisfies never}`);
  } catch (error) {
    console.error("Register handle error:", error);
    return {
      success: false as const,
      errors: {
        reason: "We couldn’t register your handle. Try again in a moment.",
      },
    };
  }
}

export default function RegisterHandle({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  if (loaderData.user.state === "registered") {
    return (
      <Page>
        <h1>Register handle</h1>
        <Feedback tone="notice">Your handle is already registered.</Feedback>
      </Page>
    );
  }

  const formErrors =
    actionData?.success === false ? actionData.errors : undefined;

  return (
    <Page>
      <h1>Register handle</h1>
      <p>
        Your handle becomes your namespace. It’s permanent, so choose one you’ll
        keep.
      </p>
      <Form method="post">
        <Field
          label="Handle"
          type="text"
          name="handle"
          className="identifier"
          autoComplete="username"
          required
          defaultValue={loaderData.user.suggestedHandle ?? ""}
          error={formErrors?.handle}
          hint="Suggested handles are not reserved until you register successfully."
        />
        <Feedback>{formErrors?.reason}</Feedback>
        <SubmitButton pendingLabel="Registering…">Register handle</SubmitButton>
      </Form>
    </Page>
  );
}
