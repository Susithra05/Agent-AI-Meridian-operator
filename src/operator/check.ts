// The checker. It reads the portal and the ledger.
// It does not trust the model's summary.
// A free-form goal only shows what changed. The three built-in jobs are graded.

import { heliosGap, inr, latestOpenHelios, prettyDate } from "./company.ts";
import type { World } from "./company.ts";

export type ScenarioId = "post-latest" | "fieldglass" | "reconcile" | "custom";

export type Check = { label: string; pass: boolean; detail: string };

export type Verdict = {
  mode: "strict" | "diff";
  pass: boolean | null;
  checks: Check[];
  gap: string;
  diff: string[];
};

function failedGap(failed: { label: string }[], coda: string): string {
  if (!failed.length) return "";
  return `VERIFICATION FAILED.\n${failed.map((check) => `- ${check.label}`).join("\n")}\n${coda}`;
}

function sameRecords(start: World, end: World): boolean {
  return (
    JSON.stringify(start.bills) === JSON.stringify(end.bills) &&
    JSON.stringify(start.approvals) === JSON.stringify(end.approvals) &&
    JSON.stringify(start.exceptions) === JSON.stringify(end.exceptions)
  );
}

export function describeDiff(start: World, end: World): string[] {
  const lines: string[] = [];
  for (const bill of end.bills) {
    if (!start.bills.some((row) => row.id === bill.id)) {
      lines.push(
        `Posted ${bill.id} · ${bill.invoiceId} · ${inr(bill.amount)} · due ${prettyDate(bill.due)} · GL ${bill.gl}`,
      );
    }
  }
  for (const approval of end.approvals) {
    const prev = start.approvals.find((row) => row.id === approval.id);
    if (!prev) {
      lines.push(
        `Opened ${approval.id} · ${approval.invoiceId} · ${inr(approval.amount)} · ${approval.status}`,
      );
    } else if (prev.status !== approval.status) {
      lines.push(`${approval.id} is now ${approval.status}`);
    }
  }
  for (const row of end.exceptions) {
    if (!start.exceptions.some((prev) => prev.id === row.id)) {
      lines.push(`Flagged ${row.id} · ${row.ruleId} · ${row.path}`);
    }
  }
  if (!lines.length) lines.push("No ledger, approval, or exception records changed.");
  return lines;
}

function cite(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.toUpperCase()))].sort();
}

export function verifyOutcome(
  scenario: ScenarioId,
  start: World,
  end: World,
  citedInvoiceIds: string[],
): Verdict {
  const diff = describeDiff(start, end);
  if (scenario === "custom") {
    return { mode: "diff", pass: null, checks: [], gap: "", diff };
  }

  if (scenario === "post-latest") {
    const target = latestOpenHelios(end);
    const fresh = end.bills.filter((bill) => !start.bills.some((row) => row.id === bill.id));
    const postedTarget = target ? fresh.find((bill) => bill.invoiceId === target.id) : undefined;
    const draftsPosted = fresh.filter((bill) =>
      end.invoices.some((invoice) => invoice.id === bill.invoiceId && invoice.status === "draft"),
    );
    const otherOpen = fresh.filter(
      (bill) =>
        target &&
        bill.invoiceId !== target.id &&
        end.invoices.some((invoice) => invoice.id === bill.invoiceId && invoice.status === "open"),
    );
    const approval = target
      ? end.approvals.find((row) => row.invoiceId === target.id && row.status === "approved")
      : undefined;
    const checks = [
      {
        label: "Latest open Helios invoice is posted",
        pass: Boolean(postedTarget),
        detail: target
          ? postedTarget
            ? `${postedTarget.id} posts ${target.id}.`
            : `${target.id} (${prettyDate(target.issued)}, ${inr(target.amount)}) is not on the ledger.`
          : "No open Helios invoice exists.",
      },
      {
        label: "Amount matches the portal",
        pass: Boolean(postedTarget && target && postedTarget.amount === target.amount),
        detail: target ? `Portal amount is ${inr(target.amount)}.` : "No target.",
      },
      {
        label: "Due date matches the portal",
        pass: Boolean(postedTarget && target && postedTarget.due === target.due),
        detail: target?.due ? `Portal due date is ${prettyDate(target.due)}.` : "No due date.",
      },
      {
        label: "Draft was not posted",
        pass: draftsPosted.length === 0,
        detail: draftsPosted.length
          ? `Posted draft ${draftsPosted.map((bill) => bill.invoiceId).join(", ")}.`
          : "No draft bills.",
      },
      {
        label: "Older open invoices were left alone",
        pass: otherOpen.length === 0,
        detail: otherOpen.length
          ? `Also posted ${otherOpen.map((bill) => bill.invoiceId).join(", ")}.`
          : "No earlier open invoice was posted.",
      },
      {
        label: "Finance approved it first",
        pass: Boolean(approval),
        detail: approval
          ? `${approval.id} is approved.`
          : "No approved finance decision for that invoice.",
      },
      {
        label: "Nothing extra was posted",
        pass: fresh.length === 1 && Boolean(postedTarget),
        detail: fresh.length ? `${fresh.length} new bill(s).` : "No new bills.",
      },
    ];
    const failed = checks.filter((check) => !check.pass);
    return {
      mode: "strict",
      pass: failed.length === 0,
      checks,
      gap: failedGap(
        failed,
        "These checks read the portal and the ledger, not your summary. If you are unsure which document is the latest open invoice, list the portal and read it. Query the ledger. Bills cannot be deleted. Then complete again.",
      ),
      diff,
    };
  }

  if (scenario === "fieldglass") {
    const freshBills = end.bills.filter((bill) => !start.bills.some((row) => row.id === bill.id));
    const flagged = end.exceptions.find((row) => row.path.includes("fieldglass"));
    const checks = [
      {
        label: "Receipt was not filed",
        pass: freshBills.length === 0,
        detail: freshBills.length
          ? `Ledger gained ${freshBills.map((bill) => bill.id).join(", ")}.`
          : "Ledger unchanged.",
      },
      {
        label: "Exception cites the Fieldglass receipt",
        pass: Boolean(flagged),
        detail: flagged ? flagged.path : "No exception points at the Fieldglass file.",
      },
      {
        label: "Rule cited is T-02",
        pass: flagged?.ruleId === "T-02",
        detail: flagged ? `Rule on the log is ${flagged.ruleId}.` : "Nothing flagged.",
      },
    ];
    const failed = checks.filter((check) => !check.pass);
    return {
      mode: "strict",
      pass: failed.length === 0,
      checks,
      gap: failedGap(
        failed,
        "Leave a receipt that breaks policy off the ledger. Flag the rule that blocks it, then list the exceptions.",
      ),
      diff,
    };
  }

  const expected = heliosGap(start);
  const citedIds = cite(citedInvoiceIds);
  const unchanged = sameRecords(start, end);
  const checks = [
    {
      label: "Nothing was posted, approved, or flagged",
      pass: unchanged,
      detail: unchanged
        ? "Records match the start of the run."
        : "The books changed. This task was report-only.",
    },
    {
      label: "Cited invoices are exactly the open gap",
      pass: citedIds.join(",") === expected.join(","),
      detail: `Operator cited ${citedIds.join(", ") || "nothing"}. The portal gap is ${expected.join(", ")}.`,
    },
  ];
  const failed = checks.filter((check) => !check.pass);
  return {
    mode: "strict",
    pass: failed.length === 0,
    checks,
    gap: failedGap(
      failed,
      "Do not change any records. On complete, invoiceIds must be only the open Helios invoices that are not already posted. Exclude drafts and paid documents.",
    ),
    diff,
  };
}
