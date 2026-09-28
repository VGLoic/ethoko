# Structured operational tracing

Central-owned production tracing uses structured `tracing` events to support incident investigation, lifecycle visibility, and development diagnosis; it is not an audit trail. Each event has a stable lowercase dotted `event` name, normally `<namespace>.<operation>.<outcome>`, concise human summary, and context-specific safe fields. The first segment identifies the owning event namespace: `auth` for the Auth bounded context, and capability namespaces such as `jobs`, `http`, `server`, and `externalcom` elsewhere.

`ERROR` means an unexpected or terminal failure requiring investigation. `WARN` is reserved for contained, recovered, degraded, security-relevant, or otherwise review-worthy conditions. `INFO` is reserved for low-frequency lifecycle and meaningful operational state transitions. Routine request, job, authentication, and notification flow belongs at `DEBUG`; `TRACE` is reserved for fine-grained internal diagnosis if introduced. Ordinary expected 4xx outcomes do not emit application warning or error events, although explicitly security- or operations-relevant conditions such as rate limiting may emit `WARN`.

Emit a failure once, at the handler, worker, supervisor, or other boundary that owns the final outcome. Lower layers add safe causal context and return errors rather than logging each propagation. A boundary failure event includes a stable classification where known and a reviewed, sanitized error chain where safe. Events must never include secrets, credentials, session tokens, OTPs, passwords, raw request bodies, email addresses, or arbitrary debug-formatted errors.

Request spans carry safe request identity and route context. Each dequeued job-processing attempt has a span carrying its job ID and topic, plus an attempt value only when the queue reliably exposes one. The ADR and code review are the enforcement mechanism; Central deliberately does not introduce a tracing facade, event registry, automatic redaction system, custom lint, or tracing-output snapshots until a concrete operational consumer requires stronger contracts.

## Considered alternatives

- *Free-text events and per-call-site level selection* — rejected because they create inconsistent queries, noisy `INFO` output, and duplicate error records.
- *Logging at every error propagation layer* — rejected because one underlying fault becomes multiple alerts without improving diagnosis.
- *Automatic redaction and a mandatory global event schema* — deferred: both would add infrastructure and constrain useful context before Central has demonstrated a need. Safe, deliberately selected fields and review are sufficient for now.
- *Using tracing as an audit or security-history store* — rejected because operational logs do not provide the durability, semantics, or access controls of an audit system.
