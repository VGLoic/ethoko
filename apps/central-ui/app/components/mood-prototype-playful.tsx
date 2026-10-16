// THROWAWAY round 4: can a tiny warehouse world make Central feel more playful?
import type { ReactNode } from "react";
import "./mood-prototype-playful.css";

type Screen = "signin" | "handle" | "home";

function WarehouseScene() {
  return (
    <svg
      className="mp-pixel-scene"
      viewBox="0 0 320 160"
      role="img"
      aria-label="Pixel-art warehouse with hanging orange lanterns, stacked crates, and two workers moving a cart."
      shapeRendering="crispEdges"
    >
      <path className="scene-sky" d="M0 0h320v160H0z" />
      <path
        className="scene-hill"
        d="M0 65h25V53h27V41h28v13h22v17h30V58h28V45h35v16h28v14h30V57h32v12h35v91H0z"
      />
      <path className="scene-ground" d="M0 127h320v33H0z" />
      <path className="scene-wall" d="M48 59h224v68H48z" />
      <path
        className="scene-roof"
        d="M38 54h10V44h14V34h196v10h14v10h10v9H38z"
      />
      <path
        className="scene-trim"
        d="M43 63h234v5H43zM53 68h6v59h-6zM261 68h6v59h-6zM145 68h6v59h-6z"
      />
      <path className="scene-door" d="M64 80h70v47H64zM160 76h89v51h-89z" />
      <path
        className="scene-slat"
        d="M168 76h3v51h-3zM181 76h3v51h-3zM194 76h3v51h-3zM207 76h3v51h-3zM220 76h3v51h-3zM233 76h3v51h-3z"
      />
      {[76, 132, 244].map((x) => (
        <g key={x}>
          <path className="scene-wire" d={`M${x} 63h2v12h-2z`} />
          <path
            className="scene-lantern"
            d={`M${x - 5} 75h12v3h3v15h-3v3h-12v-3h-3V78h3z`}
          />
          <path className="scene-lantern-light" d={`M${x - 1} 79h3v13h-3z`} />
        </g>
      ))}
      {[
        [69, 109],
        [90, 109],
        [80, 90],
        [228, 111],
        [249, 111],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <path className="scene-crate" d={`M${x} ${y}h17v17h-17z`} />
          <path
            className="scene-crate-line"
            d={`M${x + 2} ${y + 7}h13v2h-13zM${x + 7} ${y + 2}h2v13h-2z`}
          />
        </g>
      ))}
      <g className="scene-worker">
        <path className="scene-skin" d="M114 107h8v9h-8zM123 121h9v4h-9z" />
        <path
          className="scene-jacket"
          d="M111 116h13v15h-13zM109 105h16v4h-16z"
        />
        <path
          className="scene-boots"
          d="M111 131h5v9h-8v-3h3zM119 131h5v6h4v3h-9z"
        />
      </g>
      <g>
        <path className="scene-cart" d="M132 127h41v4h-41zM130 118h3v13h-3z" />
        <path
          className="scene-crate"
          d="M140 111h15v15h-15zM156 115h14v11h-14z"
        />
        <path className="scene-boots" d="M138 132h6v6h-6zM164 132h6v6h-6z" />
      </g>
      <g>
        <path className="scene-skin" d="M201 112h8v9h-8z" />
        <path
          className="scene-jacket"
          d="M198 121h14v13h-14zM198 110h14v4h-14z"
        />
        <path
          className="scene-boots"
          d="M198 134h5v7h-7v-3h2zM207 134h5v7h-5z"
        />
        <path className="scene-crate" d="M210 120h12v12h-12z" />
      </g>
      <path
        className="scene-path"
        d="M15 145h35v2H15zM64 150h18v2H64zM178 146h22v2h-22zM272 140h31v2h-31z"
      />
    </svg>
  );
}

export function PlayfulWarehouse({
  variant,
  content,
  screen,
  onScreen,
}: {
  variant: "B" | "C";
  content: ReactNode;
  screen: Screen;
  onScreen: (screen: Screen) => void;
}) {
  const navigation = (
    <nav className="mp-play-nav" aria-label="Preview screens">
      {(
        [
          ["signin", "Sign in"],
          ["handle", "Your handle"],
          ["home", "User home"],
        ] as const
      ).map(([key, label], index) => (
        <button
          key={key}
          aria-current={screen === key ? "page" : undefined}
          onClick={() => onScreen(key)}
        >
          <span aria-hidden="true">
            {variant === "C" ? `0${index + 1}` : ["↗", "@", "⌂"][index]}
          </span>
          {label}
        </button>
      ))}
    </nav>
  );
  return (
    <>
      <header className="mp-play-header">
        <div className="mp-brand">
          <span className="mp-mark" aria-hidden="true">
            ≡
          </span>
          <strong>
            ethoko<span> / central</span>
          </strong>
        </div>
        <span className="mp-play-label">
          {variant === "B"
            ? "A little order for what you build."
            : "ARTIFACT DEPOT / PREVIEW"}
        </span>
      </header>
      {variant === "B" ? (
        <main className="mp-workshop">
          <aside>
            <div className="mp-workshop-title">
              <span className="mp-eyebrow">Your little warehouse</span>
              <h2>
                Good builds.
                <br />
                In good company.
              </h2>
              <p>
                Compiler inputs, contract outputs, and a place for every tag.
              </p>
            </div>
            <div className="mp-scene-frame">
              <WarehouseScene />
              <div className="mp-scene-caption">
                <span>Room for your next build.</span>
                <span aria-hidden="true">↗</span>
              </div>
            </div>
            {navigation}
            <p className="mp-scene-note">
              Static scene study · a future home for small worker and cart
              animations.
            </p>
          </aside>
          <section className="mp-workshop-card">
            <div className="mp-card-sticker" aria-hidden="true">
              ↳
            </div>
            <div className="mp-form-area">{content}</div>
          </section>
        </main>
      ) : (
        <main className="mp-depot">
          <section className="mp-depot-world">
            <div className="mp-depot-title">
              <span>ETHOKO / NIGHT SHIFT</span>
              <span>SCENE 01</span>
            </div>
            <WarehouseScene />
            <div className="mp-depot-caption">
              <h2>
                Build packed.
                <br />
                Next stop: Central.
              </h2>
              <p>
                Your compilation artifacts,
                <br />
                ready when you are.
              </p>
            </div>
          </section>
          <div className="mp-depot-desk">
            <aside>
              {navigation}
              <div className="mp-inventory">
                <span className="mp-eyebrow">Stored together</span>
                <p>
                  <span aria-hidden="true">▤</span> Compiler inputs
                </p>
                <p>
                  <span aria-hidden="true">▦</span> Contract outputs
                </p>
                <p>
                  <span aria-hidden="true">◇</span> Tags & IDs
                </p>
              </div>
              <p className="mp-scene-note">Static scene / sample data</p>
            </aside>
            <section className="mp-depot-panel">
              <div className="mp-panel-title">
                <span>
                  {screen === "signin"
                    ? "ACCESS"
                    : screen === "handle"
                      ? "REGISTRATION"
                      : "PROFILE"}
                </span>
                <span aria-hidden="true">▪ ▪ ▪</span>
              </div>
              <div className="mp-form-area">{content}</div>
            </section>
          </div>
        </main>
      )}
    </>
  );
}
