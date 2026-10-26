// Screen only. The worker lives in src/lib/operator:
// company.ts rules, agent.ts the model call, run.ts the loop, check.ts the grader.

import { useEffect, useState } from "react";
import { OperatorPanel } from "@/components/desk/operator-panel";
import { Workspace } from "@/components/desk/workspace";
import { cn } from "@/lib/cn";
import { useDesk } from "@/operator/run";

export function Desk() {
  const status = useDesk((state) => state.status);
  const [pane, setPane] = useState<"desk" | "operator">("operator");

  useEffect(() => {
    if (status === "awaiting_approval" || status === "awaiting_answer") setPane("operator");
  }, [status]);

  return (
    <main className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-sm text-mute">Meridian Instruments · Accounts, Pune</p>
            <h1 className="font-display text-4xl leading-tight">
              Meridian <span className="italic">Operator</span>
            </h1>
          </div>
          <p className="max-w-sm text-sm text-mute">
            Give it an outcome. It has to find the procedure, do the work, and survive a check it
            does not grade itself.
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-6xl lg:hidden">
        <div className="grid grid-cols-2 gap-2 px-4 py-3" role="tablist" aria-label="View">
          {(["operator", "desk"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={pane === id}
              onClick={() => setPane(id)}
              className={cn(
                "min-h-11 rounded-lg text-sm font-semibold",
                pane === id ? "bg-ink text-copper-ink" : "bg-sheet text-ink shadow-card",
              )}
            >
              {id === "operator" ? "Operator" : "Company desk"}
            </button>
          ))}
        </div>
      </div>
      <div className="mx-auto grid max-w-6xl lg:grid-cols-5">
        <div className={cn(pane === "desk" ? "block" : "hidden", "lg:col-span-3 lg:block")}>
          <Workspace />
        </div>
        <div className={cn(pane === "operator" ? "block" : "hidden", "lg:col-span-2 lg:block")}>
          <OperatorPanel />
        </div>
      </div>
    </main>
  );
}
