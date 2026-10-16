import { useSyncExternalStore } from "react";

const STORAGE_KEY = "ethoko-theme";
const CHANGE_EVENT = "ethoko-theme-change";

// Restore the preference before styles paint; blocked storage falls back to the system.
export const themeScript = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch{}`;

// Keep the choice across root error-boundary remounts, including with blocked storage.
// This is initialized only by the browser snapshot, never during server rendering.
let currentPreference: string | undefined;

function getPreference() {
  return (currentPreference ??=
    document.documentElement.dataset.theme ?? "system");
}

function applyPreference(value: string | null) {
  currentPreference = value === "light" || value === "dark" ? value : "system";
  if (currentPreference === "system")
    delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = currentPreference;
}

function subscribe(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    const value = event.key === null ? null : event.newValue;
    applyPreference(value);
    onChange();
  }
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useThemePreference() {
  return useSyncExternalStore(subscribe, getPreference, () => "system");
}

export function ThemePreference() {
  const preference = useThemePreference();
  return (
    <label className="theme-preference">
      Appearance
      <select
        value={preference}
        onChange={(event) => {
          const value = event.target.value;
          applyPreference(value);
          try {
            if (value === "system") localStorage.removeItem(STORAGE_KEY);
            else localStorage.setItem(STORAGE_KEY, value);
          } catch {
            // Keep the current-page choice usable even when persistence is blocked.
          }
          window.dispatchEvent(new Event(CHANGE_EVENT));
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
