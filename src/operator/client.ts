// Browser side of one model turn. The API key never reaches the browser:
// we post to our own server, and the server talks to the model provider.

import type { TurnInput, TurnResult } from "./decision.ts";

export async function agentTurn(input: TurnInput): Promise<TurnResult> {
  const res = await fetch("/api/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  let body: TurnResult | null = null;
  try {
    body = (await res.json()) as TurnResult;
  } catch {
    // fall through to the generic error below
  }
  if (body && typeof body.ok === "boolean") return body;
  return { ok: false, error: `The operator server returned ${res.status} with no usable body.` };
}
