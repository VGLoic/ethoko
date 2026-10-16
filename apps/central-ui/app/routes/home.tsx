import type { Route } from "./+types/home";
import { getSessionTokenOrRedirect } from "~/server/auth.server";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";
import { Form, Link } from "react-router";
import { Page, SubmitButton } from "~/components/ui";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Home · Ethoko Central" },
    { name: "description", content: "Your Ethoko Central details." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { token } = await getSessionTokenOrRedirect(request.headers);

  const user = await ethokoCentralClient.me({ token });

  return { user };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const user = loaderData.user;

  return (
    <Page>
      <div className="profile">
        <div className="profile-row">
          <div className="font-bold">Email:</div>
          <div className="identifier">{loaderData.user.email}</div>
        </div>
        {user.state === "registered" ? (
          <div className="profile-row">
            <div className="font-bold">Handle:</div>
            <div className="identifier">{user.handle}</div>
          </div>
        ) : (
          <div className="profile-row">
            <p>Complete onboarding by registering your handle.</p>
            <Link to="/register-handle">Register handle</Link>
          </div>
        )}
        <div className="profile-row">
          <div className="font-bold">Email verified:</div>
          {loaderData.user.emailVerified ? (
            <div>Yes</div>
          ) : (
            <div className="profile-row">
              <p>No</p>
              <Link to={`verify-email?email=${loaderData.user.email}`}>
                Verify email
              </Link>
            </div>
          )}
        </div>
      </div>
      <div>
        <Form method="post" action="/logout">
          <SubmitButton secondary pendingLabel="Signing out…">
            Sign out
          </SubmitButton>
        </Form>
      </div>
    </Page>
  );
}
