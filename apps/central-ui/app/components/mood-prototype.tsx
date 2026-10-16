// THROWAWAY: Which visual and verbal direction feels like Ethoko?
// Three layouts on /login?variant=A|B|C. Sample interactions never call the API.
// Round 2 intentionally holds C's layout constant to compare palettes and serif headings.
// Add &round=1 to revisit the original structural exploration.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import "./mood-prototype.css";
import "./mood-prototype-round-two.css";
import "./mood-prototype-round-three.css";
import { PlayfulWarehouse } from "./mood-prototype-playful";

const directions = {
  A: {
    name: "Paper & Ember",
    note: "Warm paper. Soft charcoal. An editorial pace.",
    colors: ["#f4efe5", "#201d1a", "#ad4c30", "#e5a078"],
  },
  B: {
    name: "Vermilion",
    note: "Mineral surfaces. Deep red-orange. Architectural rhythm.",
    colors: ["#f0ede4", "#241918", "#ab3d28", "#f08b64"],
  },
  C: {
    name: "Ink & Copper",
    note: "Stone. Brown-black. A precise, compact workspace.",
    colors: ["#eeefea", "#191c1b", "#99502e", "#dca477"],
  },
};
type Variant = keyof typeof directions;
const palettes = {
  A: {
    name: "Stone & Ember",
    note: "Lifted graphite · ivory text · muted ember",
    dark: ["#303231", "#3b3e3b", "#f0e9dc", "#e6a080"],
    light: ["#eeefea", "#f8f8f3", "#373932", "#a25132"],
  },
  B: {
    name: "Shrine at Dusk",
    note: "Blue slate · cream text · restrained vermilion",
    dark: ["#303b46", "#3c4954", "#f1eadb", "#f2a08a"],
    light: ["#eceee9", "#f7f8f2", "#343c3c", "#ac4b37"],
  },
  C: {
    name: "Lantern Warehouse",
    note: "Smoky gray · paper text · lantern amber",
    dark: ["#353638", "#424346", "#f4e9d4", "#edbc79"],
    light: ["#f0eee7", "#faf8f1", "#3b3932", "#916126"],
  },
};
type Screen = "signin" | "handle" | "home";
const consolidated = {
  A: {
    name: "Ivory & Vermilion",
    note: "Neutral graphite · ivory · clear red-orange",
    dark: ["#323232", "#3e3e3e", "#f0e9dc", "#f47b48"],
    light: ["#eeede8", "#f8f7f2", "#383634", "#ac4b37"],
  },
  B: {
    name: "Festival Ember",
    note: "Neutral charcoal · ivory · vivid lantern orange",
    dark: ["#323232", "#3e3e3e", "#f0e9dc", "#ff8538"],
    light: ["#eeede8", "#f8f7f2", "#383634", "#bd431e"],
  },
};

function Brand() {
  return (
    <div className="mp-brand">
      <span className="mp-mark" aria-hidden="true">
        ≡
      </span>
      <strong>
        ethoko<span> / central</span>
      </strong>
    </div>
  );
}

export function MoodPrototype() {
  const [params, setParams] = useSearchParams();
  const key = params.get("variant");
  const round =
    params.get("round") === "1"
      ? "1"
      : params.get("round") === "2"
        ? "2"
        : params.get("round") === "3"
          ? "3"
          : "4";
  const roundFour = round === "4";
  const roundThree = round === "3";
  const variant: Variant =
    key === "B" || (key === "C" && !roundThree) ? key : "A";
  const dark = params.get("mode") !== "light";
  const roundTwo = round !== "1";
  const page = params.get("screen");
  const screen: Screen = page === "home" || page === "handle" ? page : "signin";
  const [feedback, setFeedback] = useState("");
  const [handle, setHandle] = useState("vincent");
  const latest = consolidated[!roundFour && variant === "B" ? "B" : "A"];
  const direction = roundFour
    ? variant === "A"
      ? { ...latest, note: "Selected reference · ivory & vermilion" }
      : {
          ...latest,
          name: variant === "B" ? "Little Warehouse" : "Night Shift",
          note:
            variant === "B"
              ? "Friendly workshop · soft panels · pixel courtyard"
              : "Retro inventory · blocky panels · lantern-lit depot",
        }
    : roundThree
      ? latest
      : roundTwo
        ? palettes[variant]
        : directions[variant];
  const colors =
    roundThree || roundFour
      ? latest[dark ? "dark" : "light"]
      : roundTwo
        ? palettes[variant][dark ? "dark" : "light"]
        : directions[variant].colors;
  function update(name: string, value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set(name, value);
        return next;
      },
      { replace: true },
    );
    setFeedback("");
  }
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          "input, textarea, select, button, [contenteditable]",
        )
      )
        return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const keys: Variant[] = roundThree ? ["A", "B"] : ["A", "B", "C"];
      const next =
        keys[
          (keys.indexOf(variant) +
            (event.key === "ArrowRight" ? 1 : keys.length - 1)) %
            keys.length
        ];
      setParams(
        (previous) => {
          const result = new URLSearchParams(previous);
          result.set("variant", next);
          return result;
        },
        { replace: true },
      );
      setFeedback("");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, roundThree, setParams]);

  const content = (
    <>
      <div className="mp-eyebrow">
        {screen === "signin"
          ? "Your artifact warehouse"
          : screen === "handle"
            ? "Getting started / 01"
            : "Your namespace"}
      </div>
      <h1>
        {screen === "signin"
          ? "Sign in to Central."
          : screen === "handle"
            ? "Choose your handle."
            : "Welcome back, Vincent."}
      </h1>
      <p className="mp-intro">
        {screen === "signin"
          ? "Store and share compilation artifacts. Pick up where you left off."
          : screen === "handle"
            ? "Your handle becomes your namespace. It’s permanent, so choose one you’ll keep."
            : "Your profile and access, in one place."}
      </p>
      {screen === "home" ? (
        <div className="mp-profile">
          <dl>
            <div>
              <dt>Namespace</dt>
              <dd>
                <code>vincent</code>
              </dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>vincent@example.com</dd>
            </div>
            <div>
              <dt>Email verification</dt>
              <dd>
                <span className="mp-status">Verified</span>
              </dd>
            </div>
          </dl>
          <div className="mp-empty">
            <span className="mp-eyebrow">Example project state</span>
            <h2>No projects yet.</h2>
            <p>
              A project groups your compilation artifacts under your namespace.
            </p>
            <button
              className="mp-primary"
              onClick={() =>
                setFeedback("Preview only — project creation is not connected.")
              }
            >
              Create project <span aria-hidden="true">↗</span>
            </button>
          </div>
          <button
            className="mp-text-button"
            onClick={() => update("screen", "signin")}
          >
            Sign out of preview ↗
          </button>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setFeedback(
              screen === "handle"
                ? `Preview: ${handle || "your-handle"} is available. No handle has been registered.`
                : "Preview: sign-in complete. No session has been created.",
            );
          }}
        >
          {screen === "signin" ? (
            <>
              <button
                className="mp-secondary"
                type="button"
                onClick={() =>
                  setFeedback(
                    "Preview: continue to GitHub to sign in. No redirect is performed.",
                  )
                }
              >
                <span aria-hidden="true">↗</span> Continue with GitHub
              </button>
              <div className="mp-divider">
                <span>or use email</span>
              </div>
              <label>
                Email
                <input
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  placeholder="Enter your password"
                  autoComplete="off"
                  required
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Handle
                <div className="mp-input-prefix">
                  <span>ethoko /</span>
                  <input
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    required
                    aria-describedby="mp-handle-note"
                  />
                </div>
              </label>
              <p id="mp-handle-note" className="mp-small">
                Your projects will use{" "}
                <code>{handle || "your-handle"}/project-name</code>.
              </p>
            </>
          )}
          <button className="mp-primary" type="submit">
            {screen === "signin" ? "Sign in" : "Register handle"}
            <span aria-hidden="true">→</span>
          </button>
          {screen === "signin" && (
            <p className="mp-form-footer">
              New to Central?{" "}
              <button
                type="button"
                className="mp-text-button"
                onClick={() => update("screen", "handle")}
              >
                Get started ↗
              </button>
            </p>
          )}
        </form>
      )}
      {feedback && (
        <p className="mp-feedback" role="status">
          {feedback}
        </p>
      )}
      <details className="mp-states">
        <summary>Writing & interface states</summary>
        <div>
          <p className="mp-status">Email verified. You’re ready to continue.</p>
          <p className="mp-error">
            We couldn’t sign you in. Check your email and password, then try
            again.
          </p>
          <p className="mp-notice">
            Verify your email to finish setup. Check your inbox for the link.
          </p>
        </div>
      </details>
    </>
  );
  const atmosphere = (
    <div className="mp-atmosphere" aria-hidden="true">
      <div className="mp-sun" />
      <div className="mp-horizon" />
      <span>ETHOKO · COMPILATION ARTIFACTS</span>
    </div>
  );

  return (
    <div
      className={`mood-prototype mp-${roundTwo ? "C" : variant} ${dark ? "mp-dark" : "mp-light"} ${roundTwo ? `mp-round-two mp-palette-${roundFour ? "A" : variant}` : ""} ${roundThree || roundFour ? "mp-round-three" : ""} ${roundFour && variant !== "A" ? `mp-playful mp-playful-${variant}` : ""}`}
    >
      {roundFour && variant !== "A" ? (
        <PlayfulWarehouse
          variant={variant}
          content={content}
          screen={screen}
          onScreen={(value) => update("screen", value)}
        />
      ) : !roundTwo && variant === "A" ? (
        <VariantA content={content} atmosphere={atmosphere} />
      ) : !roundTwo && variant === "B" ? (
        <VariantB content={content} atmosphere={atmosphere} />
      ) : (
        <VariantC
          content={content}
          screen={screen}
          onScreen={(value) => update("screen", value)}
        />
      )}
      <footer className="mp-footnote">
        <span>Compilation artifacts, kept together.</span>
        <span>Ethoko Central · Design exploration</span>
      </footer>
      {import.meta.env.DEV && (
        <div className="mp-switcher" aria-label="Prototype controls">
          <div className="mp-switch-main">
            <button
              aria-label="Previous direction"
              onClick={() =>
                update(
                  "variant",
                  roundThree
                    ? variant === "A"
                      ? "B"
                      : "A"
                    : variant === "A"
                      ? "C"
                      : variant === "B"
                        ? "A"
                        : "B",
                )
              }
            >
              ←
            </button>
            <div>
              <small>THROWAWAY · ROUND {round}</small>
              <strong>
                {variant} / {direction.name}
              </strong>
            </div>
            <button
              aria-label="Next direction"
              onClick={() =>
                update(
                  "variant",
                  roundThree
                    ? variant === "A"
                      ? "B"
                      : "A"
                    : variant === "C"
                      ? "A"
                      : variant === "A"
                        ? "B"
                        : "C",
                )
              }
            >
              →
            </button>
            <span className="mp-control-separator" />
            <select
              aria-label="Prototype round"
              value={round}
              onChange={(event) => update("round", event.target.value)}
            >
              <option value="1">Round 1</option>
              <option value="2">Round 2</option>
              <option value="3">Round 3</option>
              <option value="4">Round 4</option>
            </select>
            <button onClick={() => update("mode", dark ? "light" : "dark")}>
              {dark ? "☀ Light" : "☾ Dark"}
            </button>
            <select
              aria-label="Preview screen"
              value={screen}
              onChange={(event) => update("screen", event.target.value)}
            >
              <option value="signin">Sign in</option>
              <option value="handle">Choose handle</option>
              <option value="home">User home</option>
            </select>
          </div>
          <div className="mp-switch-meta">
            <span>{direction.note}</span>
            <div>
              {colors.map((color) => (
                <span key={color} title={color} style={{ background: color }} />
              ))}
            </div>
            <span>
              {dark ? "Dark" : "Light"} · {screen} · sample data
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function VariantA({
  content,
  atmosphere,
}: {
  content: React.ReactNode;
  atmosphere: React.ReactNode;
}) {
  return (
    <>
      <header className="mp-header">
        <Brand />
        <span className="mp-small">A place for what you build.</span>
      </header>
      <main className="mp-editorial">
        <section className="mp-editorial-aside">
          <div className="mp-eyebrow">Compile once. Keep it close.</div>
          <h2>
            Built with care.
            <br />
            Stored with clarity.
          </h2>
          {atmosphere}
          <p>
            One place for your compiler inputs,
            <br />
            contract outputs, and tags.
          </p>
        </section>
        <section className="mp-form-area">{content}</section>
      </main>
    </>
  );
}

function VariantB({
  content,
  atmosphere,
}: {
  content: React.ReactNode;
  atmosphere: React.ReactNode;
}) {
  return (
    <>
      <header className="mp-header">
        <Brand />
        <span className="mp-small">Artifacts / Access / Continuity</span>
      </header>
      <main className="mp-architecture">
        <section className="mp-form-area">{content}</section>
        <aside className="mp-architecture-aside">
          {atmosphere}
          <div>
            <span className="mp-eyebrow">From compilation to operation</span>
            <h2>
              A steady place
              <br />
              for your artifacts.
            </h2>
            <p>
              Store the build. Share the reference.
              <br />
              Return to exactly what you need.
            </p>
            <code>vincent/contracts:v1.2.3</code>
          </div>
        </aside>
      </main>
    </>
  );
}

function VariantC({
  content,
  screen,
  onScreen,
}: {
  content: React.ReactNode;
  screen: Screen;
  onScreen: (value: Screen) => void;
}) {
  return (
    <div className="mp-workbench">
      <aside className="mp-rail">
        <Brand />
        <div>
          <span className="mp-eyebrow">Central / Preview</span>
          <nav>
            {(
              [
                ["signin", "01", "Sign in"],
                ["handle", "02", "Your handle"],
                ["home", "03", "User home"],
              ] as const
            ).map(([key, number, label]) => (
              <button
                key={key}
                aria-current={screen === key ? "page" : undefined}
                onClick={() => onScreen(key)}
              >
                <span>{number}</span>
                {label}
              </button>
            ))}
          </nav>
        </div>
        <p>
          Compile once.
          <br />
          Operate with confidence.
        </p>
      </aside>
      <main>
        <header className="mp-workbench-top">
          <span>
            Central /{" "}
            {screen === "signin"
              ? "Sign in"
              : screen === "handle"
                ? "Onboarding"
                : "Profile"}
          </span>
          <span className="mp-status">Preview environment</span>
        </header>
        <div className="mp-workbench-body">
          <section className="mp-form-area">{content}</section>
          <aside className="mp-reference">
            <span className="mp-eyebrow">Artifact reference</span>
            <code>
              vincent/
              <br />
              contracts:v1.2.3
            </code>
            <p>
              A namespace. A project.
              <br />A tag that points to an artifact.
            </p>
            <hr />
            <span className="mp-eyebrow">Kept together</span>
            <ul>
              <li>Compiler inputs</li>
              <li>Contract outputs</li>
              <li>Tags and IDs</li>
            </ul>
          </aside>
        </div>
      </main>
    </div>
  );
}
