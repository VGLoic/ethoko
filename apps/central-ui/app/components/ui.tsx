import type { ComponentProps, ReactNode } from "react";
import { useNavigation } from "react-router";

export function Page({ children }: { children: ReactNode }) {
  return <main className="page surface">{children}</main>;
}

export function Feedback({
  children,
  tone = "error",
  id,
}: {
  children?: ReactNode;
  tone?: "error" | "success" | "notice";
  id?: string;
}) {
  if (!children) return null;
  return (
    <p
      id={id}
      className={`feedback feedback-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <strong>
        {tone === "error"
          ? "Error: "
          : tone === "success"
            ? "Success: "
            : "Note: "}
      </strong>
      {children}
    </p>
  );
}

export function Field({
  label,
  error,
  hint,
  ...props
}: ComponentProps<"input"> & {
  name: string;
  label: string;
  error?: string;
  hint?: string;
}) {
  const id = props.id ?? props.name;
  const description = [hint && `${id}-hint`, error && `${id}-error`]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={description || undefined}
      />
      {hint && (
        <p className="secondary" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      <Feedback id={`${id}-error`}>{error}</Feedback>
    </div>
  );
}

export function SubmitButton({
  children,
  pendingLabel = "Working…",
  secondary = false,
  intent,
}: {
  children: ReactNode;
  pendingLabel?: string;
  secondary?: boolean;
  intent?: string;
}) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const submitting =
    busy && (!intent || navigation.formData?.get("intent") === intent);
  return (
    <button
      type="submit"
      className={secondary ? "button button-secondary" : "button"}
      disabled={busy}
      aria-busy={submitting}
    >
      {submitting ? pendingLabel : children}
    </button>
  );
}
