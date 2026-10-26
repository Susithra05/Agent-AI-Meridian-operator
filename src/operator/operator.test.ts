import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDecision } from "./decision.ts";
import { verifyOutcome } from "./check.ts";
import { applyTool, createWorld, decideApproval } from "./company.ts";

test("portal times out once, then lists oldest first", () => {
  let world = createWorld(1);
  const failed = applyTool(world, "list_portal_invoices", { vendor: "Helios" });
  assert.match(failed.observation, /PORTAL_TIMEOUT/);
  assert.equal(failed.world.portalState, "down");
  world = failed.world;
  const listed = applyTool(world, "list_portal_invoices", { vendor: "Helios" });
  assert.match(listed.observation, /INV-4390[\s\S]*INV-4421/);
  assert.equal(listed.world.portalState, "up");
});

test("posting the latest Helios invoice needs approval, then sticks", () => {
  let world = createWorld(0);
  const draft = applyTool(world, "post_bill", {
    invoiceId: "INV-4421",
    vendorCode: "V-1042",
    amount: 98000,
    due: "2026-10-20",
    gl: "2100",
    evidence: "guess",
  });
  assert.match(draft.observation, /DRAFT_NOT_POSTABLE/);

  const early = applyTool(world, "post_bill", {
    invoiceId: "INV-4418",
    vendorCode: "V-1042",
    amount: 312400,
    due: "2026-10-29",
    gl: "2100",
    evidence: "Portal INV-4418",
  });
  assert.match(early.observation, /APPROVAL_REQUIRED/);

  const asked = applyTool(world, "request_approval", {
    invoiceId: "INV-4418",
    amount: 312400,
    reason: "Latest open Helios invoice is over the threshold.",
  });
  assert.equal(asked.pause, true);
  const decided = decideApproval(asked.world, "approved");
  const posted = applyTool(decided.world, "post_bill", {
    invoiceId: "INV-4418",
    vendorCode: "V-1042",
    amount: 312400,
    due: "2026-10-29",
    gl: "2100",
    evidence: "Portal INV-4418",
  });
  assert.match(posted.observation, /POSTED BILL-1009/);
  const verdict = verifyOutcome("post-latest", world, posted.world, ["INV-4418"]);
  assert.equal(verdict.pass, true);
});

test("fieldglass receipt is flagged, not filed", () => {
  const start = createWorld(0);
  const blocked = applyTool(start, "file_receipt", {
    path: "/shared/receipts/fieldglass-2026-10-04.txt",
    vendorCode: "V-2201",
    amount: 24600,
    gl: "6400",
  });
  assert.match(blocked.observation, /POLICY_BLOCK/);
  const flagged = applyTool(blocked.world, "flag_exception", {
    path: "/shared/receipts/fieldglass-2026-10-04.txt",
    ruleId: "T-02",
    explanation: "₹24,600 freight with no trip code on the receipt.",
  });
  const verdict = verifyOutcome("fieldglass", start, flagged.world, []);
  assert.equal(verdict.pass, true);
});

test("reconcile checker rejects a wrong citation and a mutation", () => {
  const start = createWorld(0);
  const wrong = verifyOutcome("reconcile", start, start, ["INV-4421"]);
  assert.equal(wrong.pass, false);
  const right = verifyOutcome("reconcile", start, start, ["INV-4412", "INV-4418"]);
  assert.equal(right.pass, true);
});

test("parser accepts fenced JSON and nested invoice ids", () => {
  const decision = parseDecision(
    '```json\n{"phase":"complete","rationale":"Checked the ledger.","tool":null,"summary":"Posted it.","result":{"invoiceIds":["inv-4418"]}}\n```',
  );
  assert.ok(decision);
  assert.equal(decision?.phase, "complete");
  assert.deepEqual(decision?.invoiceIds, ["INV-4418"]);
  assert.equal(decision?.tool, null);
});
