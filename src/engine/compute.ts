/**
 * SelfImpulse — Compute (where a seat runs).
 *
 * ADAPTED from a third-party MIT control-plane's "Compute/Driver" idea, cut to
 * the two modes a desktop agent honestly offers: a seat runs IN-PROCESS (the
 * deterministic seat, always available), or in a SIDE CAR host process when one
 * is live. A mode that cannot be provided is REFUSED in words — the product
 * never fakes a host it does not have. Rebuilt SelfImpulse-owned — attribution
 * in docs/legal/THIRD-PARTY-NOTICES.md.
 */
export type ExecutionMode = "in-process" | "host-process";

export interface ComputeTarget {
  mode: ExecutionMode;
  /** Only for a host-process seat: the endpoint it resolved to. */
  endpoint?: string;
}

export type ComputeDecision =
  | { ok: true; target: ComputeTarget }
  | { ok: false; reason: string };

/** Resolve the seat's compute. `hostEndpoint` is non-null only when a side car host is live. */
export function resolveCompute(preferred: ExecutionMode, hostEndpoint: string | null): ComputeDecision {
  if (preferred === "in-process") return { ok: true, target: { mode: "in-process" } };
  if (hostEndpoint && hostEndpoint.length > 0) {
    return { ok: true, target: { mode: "host-process", endpoint: hostEndpoint } };
  }
  return { ok: false, reason: "no host process is available on this machine — the seat refused rather than pretend to run on a host that is not there" };
}
