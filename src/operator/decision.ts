// What the model is allowed to say, and how we read it.
// Shared by the browser (run.ts) and the server (server/model.ts).
// No I/O here, so it is cheap to test.

export type Decision = {
  phase: "understand" | "plan" | "act" | "adapt" | "ask" | "complete";
  rationale: string;
  plan: string[];
  tool: { name: string; args: Record<string, string | number | boolean | null> } | null;
  question: string | null;
  summary: string | null;
  invoiceIds: string[];
};

export type TurnInput = { goal: string; notes: string[]; history: string[] };
export type TurnResult = { ok: true; decision: Decision } | { ok: false; error: string };

const PHASES = new Set(["understand", "plan", "act", "adapt", "ask", "complete"]);

function cleanTool(value: unknown): Decision["tool"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) return null;
  const rawArgs = record.args;
  const args: Record<string, string | number | boolean | null> = {};
  if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    for (const [key, item] of Object.entries(rawArgs)) {
      if (
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean" ||
        item === null
      ) {
        args[key] = item;
      } else if (item !== undefined) {
        args[key] = JSON.stringify(item);
      }
    }
  }
  return { name, args };
}

// Models sometimes put invoiceIds at the top level and sometimes under "result".
function cleanInvoiceIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const nested =
    record.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>).invoiceIds
      : undefined;
  const raw = Array.isArray(record.invoiceIds) ? record.invoiceIds : nested;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim().toUpperCase());
}

// Pulls the first {...} block out of the reply (so ```json fences are fine),
// then coerces every field to a safe shape. Returns null if there is no usable JSON.
export function parseDecision(raw: string): Decision | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const phaseRaw = typeof record.phase === "string" ? record.phase : "act";
  const phase = PHASES.has(phaseRaw) ? (phaseRaw as Decision["phase"]) : "act";
  const plan = Array.isArray(record.plan)
    ? record.plan.filter((step): step is string => typeof step === "string").slice(0, 6)
    : [];
  return {
    phase,
    rationale: typeof record.rationale === "string" ? record.rationale.slice(0, 600) : "",
    plan,
    tool: cleanTool(record.tool),
    question:
      typeof record.question === "string" && record.question.trim()
        ? record.question.trim().slice(0, 400)
        : null,
    summary:
      typeof record.summary === "string" && record.summary.trim()
        ? record.summary.trim().slice(0, 800)
        : null,
    invoiceIds: cleanInvoiceIds(record),
  };
}
