import { useEffect, useState } from "react";
import { BookOpen, Building2, Flag, FolderOpen, Landmark, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { inr, prettyDate } from "@/operator/company";
import { useDesk } from "@/operator/run";
import type { DeskTab } from "@/operator/company";

const TABS: { id: DeskTab; label: string; icon: typeof Building2 }[] = [
  { id: "portal", label: "Portal", icon: Building2 },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "ledger", label: "Ledger", icon: Landmark },
  { id: "memory", label: "Memory", icon: BookOpen },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "exceptions", label: "Exceptions", icon: Flag },
];

function recId(ref: string) {
  return `rec-${ref.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

function Status({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "text-sm font-semibold",
        value === "open" || value === "pending" ? "text-copper" : "text-mute",
      )}
    >
      {value}
    </span>
  );
}

export function Workspace() {
  const world = useDesk((state) => state.world);
  const follow = useDesk((state) => state.follow);
  const setFollow = useDesk((state) => state.setFollow);
  const [tab, setTab] = useState<DeskTab>("portal");
  const [picked, setPicked] = useState<string | null>(null);

  const shownTab = follow ? world.spotlight.tab : tab;
  const shownRef = follow ? world.spotlight.ref : picked;

  useEffect(() => {
    if (!follow || !world.spotlight.ref) return;
    document.getElementById(recId(world.spotlight.ref))?.scrollIntoView({ block: "nearest" });
  }, [follow, world.spotlight.ref, world.spotlight.tab]);

  function chooseTab(next: DeskTab) {
    setFollow(false);
    setTab(next);
  }

  function chooseRef(nextTab: DeskTab, ref: string) {
    setFollow(false);
    setTab(nextTab);
    setPicked(ref);
  }

  const posted = new Set(world.bills.map((bill) => bill.invoiceId));

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="font-display text-2xl">Company desk</h2>
          <p className="text-sm text-mute">
            What the operator can touch. It cannot see this screen.
          </p>
        </div>
        <button
          type="button"
          aria-pressed={follow}
          onClick={() => setFollow(!follow)}
          className={cn(
            "min-h-11 rounded-lg px-3 text-sm font-semibold shadow-card",
            follow ? "bg-ink text-copper-ink" : "bg-sheet text-ink",
          )}
        >
          {follow ? "Following the operator" : "Follow the operator"}
        </button>
      </div>
      <div
        className="flex gap-2 overflow-x-auto px-4 py-3"
        role="tablist"
        aria-label="Company systems"
      >
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const active = shownTab === entry.id;
          const count =
            entry.id === "approvals"
              ? world.approvals.filter((row) => row.status === "pending").length
              : entry.id === "exceptions"
                ? world.exceptions.length
                : 0;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => chooseTab(entry.id)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold",
                active ? "bg-ink text-copper-ink" : "bg-sheet text-ink shadow-card",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {entry.label}
              {count > 0 && <span className="tabular-nums">{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="space-y-3 px-4 pb-8">
        {shownTab === "portal" && (
          <>
            <p className="text-sm text-mute">
              Supplier portal
              {world.portalState === "down" && " · the operator’s last connection timed out"}
              {world.portalState === "up" && " · the operator has a live session"}
              {world.portalState === "idle" && " · the operator has not opened it yet"}
            </p>
            {world.invoices.map((invoice) => (
              <article
                key={invoice.id}
                id={recId(invoice.id)}
                className={cn(
                  "border-l-4 bg-sheet p-4 shadow-card",
                  shownRef === invoice.id ? "border-copper" : "border-transparent",
                )}
              >
                <button
                  type="button"
                  onClick={() => chooseRef("portal", invoice.id)}
                  className="w-full text-left"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-display text-xl">{invoice.id}</h3>
                    <Status value={invoice.status} />
                  </div>
                  <p className="text-sm">{invoice.vendor}</p>
                  <p className="mt-2 text-sm text-mute">
                    Issued {prettyDate(invoice.issued)} · Due {prettyDate(invoice.due)} ·{" "}
                    {invoice.vendorCode}
                  </p>
                  <p className="mt-2 font-semibold tabular-nums">{inr(invoice.amount)}</p>
                  {posted.has(invoice.id) && <p className="mt-2 text-sm">On the ledger</p>}
                </button>
                {shownRef === invoice.id && (
                  <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                    {invoice.lines.map((line) => (
                      <li key={line.description} className="flex justify-between gap-4">
                        <span>{line.description}</span>
                        <span className="tabular-nums">{inr(line.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </>
        )}

        {shownTab === "files" &&
          world.files.map((file) => (
            <article
              key={file.path}
              id={recId(file.path)}
              className={cn(
                "border-l-4 bg-sheet p-4 shadow-card",
                shownRef === file.path ? "border-copper" : "border-transparent",
              )}
            >
              <button
                type="button"
                onClick={() => chooseRef("files", file.path)}
                className="w-full text-left"
              >
                <h3 className="font-display text-xl">{file.title}</h3>
                <p className="mt-1 text-sm text-mute">{file.path}</p>
              </button>
              {shownRef === file.path && (
                <pre className="mt-3 overflow-x-auto border-t border-line pt-3 text-sm whitespace-pre-wrap">
                  {file.body}
                </pre>
              )}
            </article>
          ))}

        {shownTab === "ledger" && (
          <div className="overflow-x-auto bg-sheet shadow-card">
            <table className="w-full text-left text-sm">
              <caption className="px-4 py-3 text-left font-display text-xl">
                AP ledger · GL 2100 and 6400
              </caption>
              <thead className="text-mute">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-semibold">Bill</th>
                  <th className="px-4 py-2 font-semibold">Document</th>
                  <th className="px-4 py-2 font-semibold">Amount</th>
                  <th className="px-4 py-2 font-semibold">Due</th>
                  <th className="px-4 py-2 font-semibold">GL</th>
                </tr>
              </thead>
              <tbody>
                {world.bills.map((bill) => (
                  <tr
                    key={bill.id}
                    id={recId(bill.id)}
                    className={cn(shownRef === bill.id && "bg-paper")}
                  >
                    <td className="px-4 py-3 font-semibold">{bill.id}</td>
                    <td className="px-4 py-3">
                      {bill.invoiceId}
                      <span className="block text-mute">{bill.vendorCode}</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{inr(bill.amount)}</td>
                    <td className="px-4 py-3">{prettyDate(bill.due)}</td>
                    <td className="px-4 py-3 tabular-nums">{bill.gl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {shownTab === "memory" &&
          world.articles.map((article) => (
            <article
              key={article.id}
              id={recId(article.id)}
              className={cn(
                "border-l-4 bg-sheet p-4 shadow-card",
                shownRef === article.id ? "border-copper" : "border-transparent",
              )}
            >
              <button
                type="button"
                onClick={() => chooseRef("memory", article.id)}
                className="w-full text-left"
              >
                <p className="text-sm font-semibold text-copper">{article.id}</p>
                <h3 className="font-display text-xl">{article.title}</h3>
              </button>
              {shownRef === article.id && (
                <p className="mt-3 border-t border-line pt-3 text-sm">{article.body}</p>
              )}
            </article>
          ))}

        {shownTab === "approvals" &&
          (world.approvals.length === 0 ? (
            <p className="bg-sheet p-4 text-sm shadow-card">Nothing is waiting on finance.</p>
          ) : (
            world.approvals.map((approval) => (
              <article
                key={approval.id}
                id={recId(approval.id)}
                className="bg-sheet p-4 shadow-card"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-display text-xl">{approval.id}</h3>
                  <Status value={approval.status} />
                </div>
                <p className="mt-2 text-sm">
                  {approval.invoiceId} · {approval.vendor}
                </p>
                <p className="mt-1 font-semibold tabular-nums">{inr(approval.amount)}</p>
                <p className="mt-2 text-sm text-mute">{approval.reason}</p>
              </article>
            ))
          ))}

        {shownTab === "exceptions" &&
          (world.exceptions.length === 0 ? (
            <p className="bg-sheet p-4 text-sm shadow-card">No exceptions flagged.</p>
          ) : (
            world.exceptions.map((row) => (
              <article key={row.id} id={recId(row.id)} className="bg-sheet p-4 shadow-card">
                <h3 className="font-display text-xl">
                  {row.id} · {row.ruleId}
                </h3>
                <p className="mt-1 text-sm text-mute">{row.path}</p>
                <p className="mt-2 text-sm">{row.explanation}</p>
              </article>
            ))
          ))}
      </div>
    </section>
  );
}
