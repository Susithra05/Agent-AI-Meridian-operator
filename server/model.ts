// One model call per turn, on the server so the API key stays off the browser.
// The model must reply with a JSON object and at most one tool call.
// If the JSON is unusable we ask once more. We never invent a decision for it.
//
// Works with any OpenAI-compatible chat-completions endpoint. Configure with:
//   OPERATOR_API_KEY   (falls back to XAI_API_KEY)
//   OPERATOR_API_URL   (default https://api.x.ai/v1/chat/completions)
//   OPERATOR_MODEL     (default grok-4.5, the model the first version used)

import { parseDecision } from "../src/operator/decision.ts";
import type { TurnInput, TurnResult } from "../src/operator/decision.ts";

const SYSTEM_PROMPT = `You are the accounts operator for Meridian Instruments in Pune. You complete one company goal by using tools. You do not know invoice numbers, amounts, dates, or vendor codes until a tool in this run returns them. Never invent them. Never trust a weekly CSV over the supplier portal.

Reply with one JSON object and nothing else:
{
  "phase": "understand" | "plan" | "act" | "adapt" | "ask" | "complete",
  "rationale": "one or two concrete sentences",
  "plan": ["short steps, only when you first lay out the work"],
  "tool": { "name": "tool_name", "args": {} } or null,
  "question": null,
  "summary": null,
  "invoiceIds": []
}

Rules:
- At most one tool per reply.
- First turn: phase "understand", a short plan, and tool search_memory. Look up the procedure before acting.
- A failed or rejecting observation means the next phase is "adapt". Retry a PORTAL_TIMEOUT once before changing source.
- Latest invoice means the latest issue date whose portal status is open. Skip draft and paid.
- If post_bill or file_receipt rejects the call, believe the observation. Do not post a draft. Do not invent a due date or a trip code.
- If you see APPROVAL_REQUIRED, call request_approval and stop until an observation says APPROVED or REJECTED.
- Before phase "complete", query the record you changed (query_ledger or list_exceptions) in an earlier turn.
- phase "complete" has tool null, a summary a colleague can read, and invoiceIds for every document you posted or are reporting.
- If only a person knows a missing fact, phase "ask" and put the question in "question".
- Do not claim the goal is done when the last observation does not show it.

Tools:
- search_memory { query }
- list_portal_invoices { vendor? }
- read_portal_invoice { invoiceId }
- list_files { prefix? }
- read_file { path }
- query_ledger { vendor?, invoiceId? }
- post_bill { invoiceId, vendorCode, amount, due, gl, evidence }
- request_approval { invoiceId, amount, reason }
- file_receipt { path, vendorCode, amount, gl, tripCode? }
- flag_exception { path, ruleId, explanation }
- list_exceptions {}
- remember { text }`;

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function config() {
  return {
    apiKey: process.env.OPERATOR_API_KEY ?? process.env.XAI_API_KEY ?? "",
    url: process.env.OPERATOR_API_URL ?? "https://api.x.ai/v1/chat/completions",
    model: process.env.OPERATOR_MODEL ?? "grok-4.5",
  };
}

// Throws a "JSON_MODE ..." error when the provider rejects response_format,
// so the caller can retry once without it.
async function complete(messages: ChatMessage[], jsonMode: boolean): Promise<string> {
  const { apiKey, url, model } = config();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(40_000),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1000,
      messages,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 280);
    throw new Error(
      jsonMode ? `JSON_MODE ${res.status} ${detail}` : `Model API ${res.status}: ${detail}`,
    );
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

function userContent(input: TurnInput): string {
  const notes = input.notes.length ? input.notes.map((note) => `- ${note}`).join("\n") : "(none)";
  const history = input.history.length
    ? input.history.join("\n\n")
    : "(none — this is the first turn)";
  return `Goal:\n${input.goal}\n\nWorking notes:\n${notes}\n\nWhat has happened:\n${history}`;
}

// Throws on bad input; the HTTP layer turns that into a 400.
export function validateTurnInput(input: unknown): TurnInput {
  if (!input || typeof input !== "object") throw new Error("Bad request");
  const raw = input as Partial<TurnInput>;
  if (typeof raw.goal !== "string" || raw.goal.trim().length < 3 || raw.goal.length > 2_000) {
    throw new Error("Give the operator a goal.");
  }
  const notes = Array.isArray(raw.notes)
    ? raw.notes.filter((note): note is string => typeof note === "string").slice(0, 12)
    : [];
  const history = Array.isArray(raw.history)
    ? raw.history
        .filter((line): line is string => typeof line === "string")
        .slice(-16)
        .map((line) => line.slice(0, 1_600))
    : [];
  return { goal: raw.goal.trim(), notes, history };
}

export async function runTurn(input: TurnInput): Promise<TurnResult> {
  if (!config().apiKey) {
    return { ok: false, error: "No model API key is set. Copy .env.example to .env and add one." };
  }
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent(input) },
  ];
  try {
    let text: string;
    try {
      text = await complete(messages, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.startsWith("JSON_MODE")) throw error;
      text = await complete(messages, false);
    }
    let decision = parseDecision(text);
    if (!decision) {
      const repaired = await complete(
        [
          ...messages,
          { role: "assistant", content: text.slice(0, 1_200) },
          {
            role: "user",
            content:
              "That was not the required JSON object. Reply again with only the JSON object.",
          },
        ],
        true,
      );
      decision = parseDecision(repaired);
    }
    if (!decision)
      return {
        ok: false,
        error: "The model replied in a shape the operator could not use. Run it again.",
      };
    return { ok: true, decision };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model call failed.";
    return { ok: false, error: message.replace(/^JSON_MODE /, "Model API ") };
  }
}
