// End-to-end tests of the loop (run.ts) with a scripted model.
// No network and no API key: fetch is replaced, so each test decides exactly
// what the "model" says on every turn. The company world and the checker are real.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { Decision } from "./decision.ts";
import { JOBS, useDesk } from "./run.ts";

type Scripted = Partial<Decision>;

let script: Decision[] = [];
let modelCalls = 0;

function turn(partial: Scripted): Decision {
  return {
    phase: "act",
    rationale: "scripted",
    plan: [],
    tool: null,
    question: null,
    summary: null,
    invoiceIds: [],
    ...partial,
  };
}

function tool(name: string, args: Record<string, string | number | boolean | null> = {}): Scripted {
  return { tool: { name, args } };
}

beforeEach(() => {
  modelCalls = 0;
  script = [];
  globalThis.fetch = (async () => {
    modelCalls += 1;
    const next = script.shift();
    if (!next)
      throw new Error("The script ran out: the loop asked the model for an unplanned turn.");
    return { ok: true, status: 200, json: async () => ({ ok: true, decision: next }) } as Response;
  }) as typeof fetch;
  useDesk.getState().reset();
});

async function waitFor(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for: ${label} (status=${useDesk.getState().status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const POST_LATEST = JOBS[0]!.goal;

const POST_ARGS = {
  invoiceId: "INV-4418",
  vendorCode: "V-1042",
  amount: 312400,
  due: "2026-10-29",
  gl: "2100",
  evidence: "Portal INV-4418",
};

test("post-latest: survives a portal timeout, waits for approval, posts, passes the checker", async () => {
  script = [
    turn({
      phase: "understand",
      plan: ["find policy", "read portal", "post"],
      ...tool("search_memory", { query: "invoice posting approval" }),
    }),
    turn(tool("list_portal_invoices", { vendor: "Helios" })), // PORTAL_TIMEOUT
    turn({ phase: "adapt", ...tool("list_portal_invoices", { vendor: "Helios" }) }), // retry works
    turn(tool("read_portal_invoice", { invoiceId: "INV-4418" })),
    turn(
      tool("request_approval", {
        invoiceId: "INV-4418",
        amount: 312400,
        reason: "Latest open Helios invoice is over the threshold.",
      }),
    ),
    // loop pauses here until a person approves
    turn(tool("post_bill", POST_ARGS)),
    turn(tool("query_ledger", { vendor: "Helios" })),
    turn({
      phase: "complete",
      summary: "Posted INV-4418 after approval.",
      invoiceIds: ["INV-4418"],
    }),
  ];

  const desk = useDesk.getState();
  desk.setGoal(POST_LATEST);
  desk.start();

  await waitFor(() => useDesk.getState().status === "awaiting_approval", "approval pause");
  assert.equal(useDesk.getState().world.bills.length, 1, "nothing may be posted before approval");
  assert.ok(
    useDesk
      .getState()
      .trace.some((row) => row.kind === "observe" && /PORTAL_TIMEOUT/.test(row.body)),
    "the portal outage should appear in the trace",
  );

  useDesk.getState().approve();
  await waitFor(() => useDesk.getState().status === "done", "run to finish");

  const end = useDesk.getState();
  assert.equal(end.verdict?.mode, "strict");
  assert.equal(end.verdict?.pass, true, end.verdict?.gap);
  assert.equal(end.world.bills.length, 2);
  assert.equal(modelCalls, 8);
});

test("rejecting the approval keeps the books unchanged", async () => {
  script = [
    turn(
      tool("request_approval", {
        invoiceId: "INV-4418",
        amount: 312400,
        reason: "Latest open Helios invoice is over the threshold.",
      }),
    ),
    turn({
      phase: "complete",
      summary: "Finance refused INV-4418, so I did not post it.",
      invoiceIds: [],
    }),
    turn({
      phase: "complete",
      summary: "Finance refused INV-4418, so I did not post it.",
      invoiceIds: [],
    }),
  ];
  useDesk.getState().setGoal(POST_LATEST);
  useDesk.getState().setPortalFlakes(false);
  useDesk.getState().start();

  await waitFor(() => useDesk.getState().status === "awaiting_approval", "approval pause");
  useDesk.getState().reject();
  await waitFor(() => useDesk.getState().status === "done", "run to finish");

  const end = useDesk.getState();
  assert.equal(end.world.bills.length, 1, "no bill was posted");
  assert.equal(end.world.approvals[0]?.status, "rejected");
  assert.equal(end.verdict?.pass, false, "the goal was not achieved, and the checker says so");
});

test("a premature 'done' is sent back once by the checker, then reported as unverified", async () => {
  script = [
    turn({ phase: "complete", summary: "All done.", invoiceIds: ["INV-4418"] }),
    turn({ phase: "complete", summary: "Still done.", invoiceIds: ["INV-4418"] }),
  ];
  useDesk.getState().setGoal(POST_LATEST);
  useDesk.getState().setPortalFlakes(false);
  useDesk.getState().start();

  await waitFor(() => useDesk.getState().status === "done", "run to finish");
  const end = useDesk.getState();
  assert.equal(end.verdict?.pass, false);
  assert.equal(end.verifyRetried, true);
  assert.ok(end.trace.some((row) => row.title === "Checker sent it back"));
  assert.ok(end.trace.some((row) => row.title === "Finished unverified"));
  assert.equal(end.world.bills.length, 1);
});

test("posting a draft is rejected by the world, not trusted to the model", async () => {
  script = [
    turn(
      tool("post_bill", { ...POST_ARGS, invoiceId: "INV-4421", amount: 98000, due: "2026-10-20" }),
    ),
    turn({ phase: "complete", summary: "Gave up.", invoiceIds: [] }),
    turn({ phase: "complete", summary: "Gave up.", invoiceIds: [] }),
  ];
  useDesk.getState().setGoal(POST_LATEST);
  useDesk.getState().setPortalFlakes(false);
  useDesk.getState().start();

  await waitFor(() => useDesk.getState().status === "done", "run to finish");
  const end = useDesk.getState();
  assert.equal(end.world.bills.length, 1, "the draft must not reach the ledger");
  assert.ok(
    end.trace.some((row) => row.title === "Tool rejected" && /DRAFT_NOT_POSTABLE/.test(row.body)),
  );
});

test("the run stops at the model-call cap even if the model never finishes", async () => {
  script = Array.from({ length: 12 }, () => turn(tool("list_files", { prefix: "/shared" })));
  useDesk.getState().setGoal(POST_LATEST);
  useDesk.getState().setPortalFlakes(false);
  useDesk.getState().start();

  await waitFor(() => useDesk.getState().status === "done", "cap to trigger");
  assert.equal(modelCalls, 10);
  assert.ok(useDesk.getState().trace.some((row) => row.title === "Stopped at the call limit"));
});

test("fieldglass: the operator flags the receipt instead of filing it", async () => {
  const path = "/shared/receipts/fieldglass-2026-10-04.txt";
  script = [
    turn(tool("read_file", { path })),
    turn(tool("file_receipt", { path, vendorCode: "V-2201", amount: 24600, gl: "6400" })), // POLICY_BLOCK
    turn({
      phase: "adapt",
      ...tool("flag_exception", {
        path,
        ruleId: "T-02",
        explanation: "INR 24,600 freight with no trip code on the receipt.",
      }),
    }),
    turn(tool("list_exceptions")),
    turn({ phase: "complete", summary: "Flagged under T-02; ledger unchanged.", invoiceIds: [] }),
  ];
  useDesk.getState().setGoal(JOBS[1]!.goal);
  useDesk.getState().start();

  await waitFor(() => useDesk.getState().status === "done", "run to finish");
  const end = useDesk.getState();
  assert.equal(end.verdict?.pass, true, end.verdict?.gap);
  assert.equal(end.world.bills.length, 1);
  assert.equal(end.world.exceptions.length, 1);
});

test("a free-form goal can ask a person, then finishes with a diff-only verdict", async () => {
  script = [
    turn({ phase: "ask", question: "Which vendor do you mean?" }),
    turn({ phase: "complete", summary: "Nothing to change for Helios.", invoiceIds: [] }),
  ];
  useDesk.getState().setGoal("Tidy up the vendor records for me please.");
  useDesk.getState().start();

  await waitFor(() => useDesk.getState().status === "awaiting_answer", "question");
  assert.equal(useDesk.getState().pendingQuestion, "Which vendor do you mean?");

  useDesk.getState().setAnswerDraft("Helios");
  useDesk.getState().submitAnswer();
  await waitFor(() => useDesk.getState().status === "done", "run to finish");

  const end = useDesk.getState();
  assert.equal(end.verdict?.mode, "diff");
  assert.equal(end.verdict?.pass, null);
  assert.ok(end.trace.some((row) => row.title === "A person answered"));
});

test("a failed model call surfaces as an error state, not a fake decision", async () => {
  globalThis.fetch = (async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: "Model API 401: bad key" }),
    } as Response;
  }) as typeof fetch;
  useDesk.getState().setGoal(POST_LATEST);
  useDesk.getState().start();

  await waitFor(() => useDesk.getState().status === "error", "error state");
  assert.match(useDesk.getState().error ?? "", /401/);
  assert.equal(useDesk.getState().world.bills.length, 1);
});
