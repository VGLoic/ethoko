import { randomUUID } from "node:crypto";
import { createServer } from "@msw/serve";
import { http, HttpResponse } from "msw";
import { z } from "zod";
import { Identity, ScenarioInput } from "./protocol.ts";
import { apiUrl, machineCredential } from "./settings.ts";

type Scenario = z.infer<typeof Identity> & {
  login: z.infer<typeof ScenarioInput>["login"];
  active: boolean;
  loggedIn: boolean;
  requests: string[];
  violations: string[];
};

const scenarios = new Map<string, Scenario>();
const violations: string[] = [];
const pending = new Set<Promise<void>>();

function violation(request: Request, reason: string, scenario?: Scenario) {
  const message = `${request.method} ${new URL(request.url).pathname}: ${reason}${scenario ? ` (scenario ${scenario.id}, ${scenario.email})` : " (unattributed)"}`;
  violations.push(message);
  scenario?.violations.push(message);
  console.error(message);
  return HttpResponse.json({ error: message }, { status: 500 });
}

// Only used by the explicit two-worker check: neither browser proceeds until
// two active, contrasting scenarios have arrived at this shared server.
const concurrent = new Map<string, (response: Response) => void>();

const server = createServer(
  http.get("/__test/health", () => HttpResponse.json({ ready: true })),
  http.post("/__test/scenarios", async ({ request }) => {
    const input = ScenarioInput.parse(await request.json());
    const id = randomUUID();
    const identity = {
      id,
      email: `user-${id}@example.com`,
      password: `Pw1!${randomUUID()}`,
      handle: `user-${id.slice(0, 18)}`,
      token: randomUUID(),
    };
    scenarios.set(id, {
      ...identity,
      ...input,
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
  http.post("/__test/concurrent", async ({ request }) => {
    const { id } = z.object({ id: z.string() }).parse(await request.json());
    if (!scenarios.get(id)?.active)
      return new HttpResponse(null, { status: 400 });
    return new Promise<Response>((resolve) => {
      concurrent.set(id, resolve);
      if (concurrent.size < 2) return;
      const outcomes = new Set(
        [...concurrent.keys()].map((key) => scenarios.get(key)?.login),
      );
      const status = outcomes.size === 2 ? 200 : 400;
      for (const release of concurrent.values())
        release(HttpResponse.json({ concurrent: concurrent.size }, { status }));
      concurrent.clear();
    });
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
  http.all("*", async ({ request }) => {
    const path = new URL(request.url).pathname;
    const token = request.headers
      .get("X-Ethoko-User-Authorization")
      ?.replace(/^Bearer /, "");
    let scenario = [...scenarios.values()].find((item) => item.token === token);
    let body: unknown;
    const rawBody = await request.text();
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return violation(request, "malformed JSON", scenario);
      }
    }
    const email = z.object({ email: z.string() }).safeParse(body);
    if (!scenario && email.success) {
      scenario = [...scenarios.values()].find(
        (item) => item.email === email.data.email,
      );
    }
    if (!scenario)
      return violation(
        request,
        `unknown identity (email=${email.success ? email.data.email : "missing"}, User Session Token=${token ?? "missing"})`,
      );
    scenario.requests.push(`${request.method} ${path}`);
    if (!scenario.active)
      return violation(request, "request after scenario retirement", scenario);
    if (
      request.headers.get("Authorization") !== `Bearer ${machineCredential}`
    ) {
      return violation(request, "invalid Machine Credential", scenario);
    }
    if (new URL(request.url).search)
      return violation(request, "unexpected query parameters", scenario);
    if (request.method === "POST" && path === "/auth/login/email") {
      const payload = z
        .object({ email: z.email(), password: z.string() })
        .strict()
        .safeParse(body);
      if (
        !payload.success ||
        payload.data.email !== scenario.email ||
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
    if (
      (request.method === "GET" && path === "/auth/me") ||
      (request.method === "POST" && path === "/auth/logout")
    ) {
      if (
        request.headers.get("X-Ethoko-User-Authorization") !==
          `Bearer ${scenario.token}` ||
        !scenario.loggedIn ||
        rawBody
      ) {
        return violation(
          request,
          "invalid User Session Token, session state, or payload",
          scenario,
        );
      }
      if (path === "/auth/logout") {
        scenario.loggedIn = false;
        return new HttpResponse(null, { status: 204 });
      }
      return HttpResponse.json({
        state: "registered",
        email: scenario.email,
        handle: scenario.handle,
        emailVerified: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });
    }
    return violation(request, "unexpected operation", scenario);
  }),
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
