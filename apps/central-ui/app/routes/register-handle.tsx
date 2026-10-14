import { Form, redirect } from "react-router";
import z from "zod";
import type { Route } from "./+types/register-handle";
import { getSessionTokenOrRedirect } from "~/server/auth.server";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";
import { HandleSchema } from "~/server/newtypes.server";

export function meta() {
  return [
    { title: "Register Handle" },
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
            handle: "This handle is not available",
          },
        };
      }

      if (registerHandleResult.reason === "invalid-handle") {
        return {
          success: false as const,
          errors: {
            handle: "This handle is not allowed",
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
        reason: "An error occurred while registering the handle.",
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
      <main className="flex flex-col pt-16 pb-4 px-8 gap-8">
        <h1 className="flex justify-center">Register Handle</h1>
        <p className="text-center">Your handle is already registered.</p>
      </main>
    );
  }

  const formErrors =
    actionData?.success === false ? actionData.errors : undefined;

  return (
    <main className="flex flex-col pt-16 pb-4 px-8 gap-8">
      <h1 className="flex justify-center">Register Handle</h1>
      <p className="text-center">
        Choose your permanent handle. Suggested handles are not reserved until
        you submit one successfully.
      </p>
      <Form method="post" className="flex flex-col gap-4">
        <label>
          Handle:
          <input
            type="text"
            name="handle"
            required
            defaultValue={loaderData.user.suggestedHandle ?? ""}
            className="border p-2"
          />
          {formErrors?.handle ? (
            <p className="text-red-500">{formErrors.handle}</p>
          ) : null}
        </label>
        {formErrors?.reason ? (
          <p className="text-red-500">{formErrors.reason}</p>
        ) : null}
        <button type="submit">Register Handle</button>
      </Form>
    </main>
  );
}
