import { createServer } from "@msw/serve";
import { http, HttpResponse } from "msw";
import { z } from "zod";
import { Identity, ScenarioInput } from "./protocol.ts";
import { apiUrl, machineCredential } from "./settings.ts";

type Scenario = z.infer<typeof Identity> & {
  login: z.infer<typeof ScenarioInput>["login"];
  signup: z.infer<typeof ScenarioInput>["signup"];
  active: boolean;
  loggedIn: boolean;
  requests: string[];
  violations: string[];
};

const scenarios = new Map<string, Scenario>();
const violations: string[] = [];
const pending = new Set<Promise<void>>();

const apiHandlers = [
  http.post(`${apiUrl}/auth/signup/email`, handleEmailSignup),
  http.post(`${apiUrl}/auth/login/email`, handleEmailLogin),
  http.get(`${apiUrl}/auth/me`, handleCurrentUser),
  http.post(`${apiUrl}/auth/logout`, handleLogout),
];

function violation(request: Request, reason: string, scenario?: Scenario) {
  const message = `${request.method} ${new URL(request.url).pathname}: ${reason}${scenario ? ` (scenario ${scenario.id}, ${scenario.email})` : " (unattributed)"}`;
  violations.push(message);
  scenario?.violations.push(message);
  console.error(message);
  return HttpResponse.json({ error: message }, { status: 500 });
}

function findScenarioByEmail(email: string) {
  return [...scenarios.values()].find((scenario) => scenario.email === email);
}

function findScenarioByToken(request: Request) {
  const token = request.headers
    .get("X-Ethoko-User-Authorization")
    ?.replace(/^Bearer /, "");
  return [...scenarios.values()].find((scenario) => scenario.token === token);
}

function validateScenarioRequest(request: Request, scenario: Scenario) {
  scenario.requests.push(`${request.method} ${new URL(request.url).pathname}`);
  if (!scenario.active)
    return violation(request, "request after scenario retirement", scenario);
  if (request.headers.get("Authorization") !== `Bearer ${machineCredential}`)
    return violation(request, "invalid Machine Credential", scenario);
  if (new URL(request.url).search)
    return violation(request, "unexpected query parameters", scenario);
}

async function authenticatedScenario(
  request: Request,
): Promise<Scenario | Response> {
  let scenario = findScenarioByToken(request);
  if (!scenario) {
    // An invalid authenticated payload may still identify its owning scenario.
    // Use its email for diagnostics only; the token checks below still reject it.
    const body: unknown = await request
      .clone()
      .json()
      .catch(() => null);
    const email = z.object({ email: z.string() }).safeParse(body);
    scenario = email.success
      ? findScenarioByEmail(email.data.email)
      : undefined;
  }
  if (!scenario) {
    return violation(
      request,
      `unknown User Session Token (${request.headers.get("X-Ethoko-User-Authorization") ?? "missing"})`,
    );
  }
  const error = validateScenarioRequest(request, scenario);
  if (error) return error;
  if (
    request.headers.get("X-Ethoko-User-Authorization") !==
      `Bearer ${scenario.token}` ||
    !scenario.loggedIn ||
    (await request.text())
  ) {
    return violation(
      request,
      "invalid User Session Token, session state, or payload",
      scenario,
    );
  }
  return scenario;
}

async function handleEmailLogin({ request }: { request: Request }) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return violation(request, "malformed JSON", findScenarioByToken(request));
  }
  const email = z.object({ email: z.string() }).safeParse(body);
  const scenario = email.success
    ? findScenarioByEmail(email.data.email)
    : undefined;
  if (!scenario) {
    return violation(
      request,
      `unknown identity (email=${email.success ? email.data.email : "missing"})`,
      findScenarioByToken(request),
    );
  }
  const error = validateScenarioRequest(request, scenario);
  if (error) return error;
  const payload = z
    .object({ email: z.email(), password: z.string() })
    .strict()
    .safeParse(body);
  if (
    !payload.success ||
    payload.data.password !== scenario.password ||
    request.headers.has("X-Ethoko-User-Authorization") ||
    !request.headers.get("Content-Type")?.includes("application/json")
  ) {
    return violation(
      request,
      "invalid email login payload or headers",
      scenario,
    );
  }
  if (scenario.login === "invalid-credentials") {
    return HttpResponse.json(
      { code: "ETKAL01", reason: "Invalid email or password" },
      { status: 422 },
    );
  }
  scenario.loggedIn = true;
  return HttpResponse.json({ token: scenario.token });
}

async function handleEmailSignup({ request }: { request: Request }) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return violation(request, "malformed JSON", findScenarioByToken(request));
  }
  const email = z.object({ email: z.string() }).safeParse(body);
  const scenario = email.success
    ? findScenarioByEmail(email.data.email)
    : undefined;
  if (!scenario) {
    return violation(
      request,
      `unknown identity (email=${email.success ? email.data.email : "missing"})`,
      findScenarioByToken(request),
    );
  }
  const error = validateScenarioRequest(request, scenario);
  if (error) return error;
  const payload = z
    .object({ email: z.email(), password: z.string() })
    .strict()
    .safeParse(body);
  if (
    !payload.success ||
    payload.data.password !== scenario.password ||
    request.headers.has("X-Ethoko-User-Authorization") ||
    !request.headers.get("Content-Type")?.includes("application/json")
  ) {
    return violation(
      request,
      "invalid email signup payload or headers",
      scenario,
    );
  }
  if (scenario.signup !== "success") {
    return violation(
      request,
      "signup not configured for this scenario",
      scenario,
    );
  }
  return HttpResponse.json(
    {
      email: scenario.email,
      emailVerified: false,
      createdAt: scenario.createdAt,
      updatedAt: scenario.updatedAt,
    },
    { status: 201 },
  );
}

async function handleCurrentUser({ request }: { request: Request }) {
  const scenario = await authenticatedScenario(request);
  if (scenario instanceof Response) return scenario;
  return HttpResponse.json({
    state: scenario.state,
    email: scenario.email,
    handle: scenario.handle,
    emailVerified: scenario.emailVerified,
    createdAt: scenario.createdAt,
    updatedAt: scenario.updatedAt,
  });
}

async function handleLogout({ request }: { request: Request }) {
  const scenario = await authenticatedScenario(request);
  if (scenario instanceof Response) return scenario;
  scenario.loggedIn = false;
  return new HttpResponse(null, { status: 204 });
}

const controlHandlers = [
  http.get("/__test/health", () => HttpResponse.json({ ready: true })),
  http.post("/__test/scenarios", async ({ request }) => {
    const input = ScenarioInput.parse(await request.json());
    const { identity, login, signup } = input;
    if (
      [...scenarios.values()].some(
        (scenario) =>
          scenario.id === identity.id ||
          scenario.email === identity.email ||
          scenario.token === identity.token,
      )
    ) {
      return HttpResponse.json(
        { error: "Scenario id, email, or token already in use" },
        { status: 409 },
      );
    }
    scenarios.set(identity.id, {
      ...identity,
      login,
      signup,
      active: true,
      loggedIn: false,
      requests: [],
      violations: [],
    });
    return HttpResponse.json(identity, { status: 201 });
  }),
  http.get("/__test/scenarios/:id", ({ params }) => {
    const scenario = scenarios.get(String(params.id));
    return scenario
      ? HttpResponse.json(scenario)
      : new HttpResponse(null, { status: 404 });
  }),
  http.delete("/__test/scenarios/:id", ({ params }) => {
    const scenario = scenarios.get(String(params.id));
    if (!scenario) return new HttpResponse(null, { status: 404 });
    // Keep identity tombstones so late traffic is still attributable.
    scenario.active = false;
    return HttpResponse.json(scenario);
  }),
  http.post("/__test/audit", async () => {
    // Close ingress and drain accepted requests before taking the final snapshot.
    // Otherwise a body still being read could report a violation after the audit.
    server.close();
    server.closeIdleConnections();
    await Promise.all(pending);
    return HttpResponse.json({
      scenarios: [...scenarios.values()],
      violations,
    });
  }),
];

// The catch-all only diagnoses requests which match no Central API operation.
const unexpectedRequestHandler = http.all("*", async ({ request }) => {
  let scenario = findScenarioByToken(request);
  const rawBody = await request.text();
  let body: unknown;
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return violation(request, "malformed JSON", scenario);
    }
  }
  const email = z.object({ email: z.string() }).safeParse(body);
  scenario ??= email.success
    ? findScenarioByEmail(email.data.email)
    : undefined;
  scenario?.requests.push(`${request.method} ${new URL(request.url).pathname}`);
  return violation(
    request,
    `unexpected operation (email=${email.success ? email.data.email : "missing"}, User Session Token=${request.headers.get("X-Ethoko-User-Authorization") ?? "missing"})`,
    scenario,
  );
});

const server = createServer(
  ...controlHandlers,
  ...apiHandlers,
  unexpectedRequestHandler,
);

server.prependListener("request", (request, response) => {
  if (request.url === "/__test/audit") return;
  const finished = new Promise<void>((resolve) => {
    response.once("finish", resolve);
    response.once("close", resolve);
  });
  pending.add(finished);
  void finished.then(() => pending.delete(finished));
});

server.listen(Number(new URL(apiUrl).port), "127.0.0.1", () => {
  console.log(`Mock Central API ready at ${apiUrl} (pid ${process.pid})`);
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    server.closeIdleConnections();
  });
}
