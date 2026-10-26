import { useEffect, useRef } from "react";
import { Check, Play, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { JOBS, useDesk } from "@/operator/run";
import type { TraceKind } from "@/operator/run";

const LOOP = [
  "Goal",
  "Understand",
  "Plan",
  "Execute",
  "Observe",
  "Adapt",
  "Verify",
  "Complete",
] as const;

function loopIndex(status: string, kind: TraceKind | undefined, waiting: boolean): number {
  if (status === "idle") return 0;
  if (status === "done") return 7;
  if (status === "awaiting_answer" || status === "awaiting_approval") return 5;
  if (waiting) return 1;
  switch (kind) {
    case "understand":
      return 1;
    case "plan":
      return 2;
    case "execute":
      return 3;
    case "observe":
      return 4;
    case "adapt":
    case "ask":
      return 5;
    case "verify":
      return 6;
    case "complete":
      return 7;
    default:
      return 1;
  }
}

function TraceBody({ body }: { body: string }) {
  const lines = body.split("\n");
  const preview = lines.slice(0, 2).join("\n");
  const rest = lines.slice(2).join("\n").trim();
  return (
    <div className="mt-1 text-sm">
      <p className="whitespace-pre-wrap">{preview}</p>
      {rest && (
        <details className="mt-1">
          <summary className="min-h-11 cursor-pointer text-mute">Full note</summary>
          <p className="whitespace-pre-wrap">{rest}</p>
        </details>
      )}
    </div>
  );
}

export function OperatorPanel() {
  const goal = useDesk((state) => state.goal);
  const setGoal = useDesk((state) => state.setGoal);
  const scenario = useDesk((state) => state.scenario);
  const status = useDesk((state) => state.status);
  const trace = useDesk((state) => state.trace);
  const notes = useDesk((state) => state.notes);
  const verdict = useDesk((state) => state.verdict);
  const summary = useDesk((state) => state.summary);
  const error = useDesk((state) => state.error);
  const modelCalls = useDesk((state) => state.modelCalls);
  const pendingQuestion = useDesk((state) => state.pendingQuestion);
  const answerDraft = useDesk((state) => state.answerDraft);
  const setAnswerDraft = useDesk((state) => state.setAnswerDraft);
  const portalFlakes = useDesk((state) => state.portalFlakes);
  const setPortalFlakes = useDesk((state) => state.setPortalFlakes);
  const waiting = useDesk((state) => state.waiting);
  const world = useDesk((state) => state.world);
  const start = useDesk((state) => state.start);
  const stop = useDesk((state) => state.stop);
  const reset = useDesk((state) => state.reset);
  const approve = useDesk((state) => state.approve);
  const reject = useDesk((state) => state.reject);
  const submitAnswer = useDesk((state) => state.submitAnswer);
  const verdictRef = useRef<HTMLDivElement>(null);

  const busy =
    status === "running" || status === "awaiting_approval" || status === "awaiting_answer";
  const pending = world.approvals.find((row) => row.status === "pending");
  const active = loopIndex(status, trace.at(-1)?.kind, waiting);

  useEffect(() => {
    if (status === "done" || status === "awaiting_approval" || status === "awaiting_answer") {
      verdictRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [status]);

  return (
    <section className="min-w-0 border-t border-line lg:border-t-0 lg:border-l">
      <div className="px-4 py-4">
        <p className="text-sm text-mute">Operator</p>
        <h2 className="font-display text-2xl">Finish the work</h2>
        <ol className="mt-3 flex flex-wrap gap-x-3 gap-y-1" aria-label="Operator loop">
          {LOOP.map((step, index) => (
            <li
              key={step}
              className={cn("text-sm", index === active ? "font-semibold text-ink" : "text-mute")}
            >
              {step}
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-3 px-4">
        <label className="block">
          <span className="text-sm font-semibold">Goal</span>
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            rows={4}
            disabled={busy}
            className="mt-2 w-full resize-y rounded-xl border border-line bg-sheet px-3 py-3 text-base"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {status === "running" ? (
            <Button type="button" variant="line" onClick={stop}>
              <Square className="size-4" aria-hidden="true" />
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              onClick={start}
              disabled={
                !goal.trim() || status === "awaiting_approval" || status === "awaiting_answer"
              }
            >
              <Play className="ml-px size-4" aria-hidden="true" />
              {status === "done" || status === "stopped" || status === "error"
                ? "Run again"
                : "Run operator"}
            </Button>
          )}
          <Button type="button" variant="quiet" onClick={reset} disabled={status === "running"}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Reset desk
          </Button>
        </div>
        <div className="grid gap-2">
          {JOBS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={scenario === entry.id && goal === entry.goal}
              disabled={busy}
              onClick={() => setGoal(entry.goal)}
              className={cn(
                "min-h-11 rounded-lg px-3 py-2 text-left text-sm shadow-card disabled:opacity-50",
                goal === entry.goal ? "bg-ink text-copper-ink" : "bg-sheet text-ink",
              )}
            >
              <span className="font-semibold">{entry.label}</span>
              <span
                className={cn("block", goal === entry.goal ? "text-copper-ink/80" : "text-mute")}
              >
                {entry.blurb}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={portalFlakes}
          disabled={busy}
          onClick={() => setPortalFlakes(!portalFlakes)}
          className="min-h-11 w-full rounded-lg bg-sheet px-3 text-left text-sm shadow-card disabled:opacity-50"
        >
          <span className="font-semibold">
            {portalFlakes ? "On" : "Off"} · Portal drops the first connection
          </span>
        </button>
        {modelCalls > 0 && (
          <p className="text-sm text-mute tabular-nums">
            {modelCalls} model call{modelCalls === 1 ? "" : "s"}
            {waiting ? " · thinking" : ""}
            {status === "running" && !waiting ? " · acting" : ""}
          </p>
        )}
      </div>

      <div ref={verdictRef} className="mt-4 space-y-3 px-4 pb-8" aria-live="polite">
        {error && (
          <p className="border-l-4 border-copper bg-sheet p-4 text-sm shadow-card" role="alert">
            {error}
          </p>
        )}

        {status === "awaiting_approval" && pending && (
          <div className="bg-ink p-4 text-copper-ink shadow-card">
            <p className="text-sm">Finance has to decide</p>
            <h3 className="mt-1 font-display text-2xl">
              {pending.id} · {pending.invoiceId}
            </h3>
            <p className="mt-2 text-sm">{pending.reason}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" onClick={approve}>
                <Check className="size-4" aria-hidden="true" />
                Approve
              </Button>
              <Button type="button" variant="line" onClick={reject}>
                Refuse
              </Button>
            </div>
          </div>
        )}

        {status === "awaiting_answer" && pendingQuestion && (
          <form
            className="bg-sheet p-4 shadow-card"
            onSubmit={(event) => {
              event.preventDefault();
              submitAnswer();
            }}
          >
            <h3 className="font-display text-xl">The operator is asking</h3>
            <p className="mt-2 text-sm">{pendingQuestion}</p>
            <label className="mt-3 block">
              <span className="sr-only">Your answer</span>
              <textarea
                value={answerDraft}
                onChange={(event) => setAnswerDraft(event.target.value)}
                rows={3}
                className="w-full rounded-xl border border-line bg-paper px-3 py-3 text-base"
              />
            </label>
            <Button type="submit" className="mt-3" disabled={!answerDraft.trim()}>
              Send answer
            </Button>
          </form>
        )}

        {verdict && status === "done" && (
          <div
            className={cn(
              "bg-sheet p-4 shadow-card",
              verdict.pass === false && "border-l-4 border-copper",
            )}
          >
            <h3 className="font-display text-xl">
              {verdict.mode === "diff" ? "Record diff" : verdict.pass ? "Verified" : "Not verified"}
            </h3>
            {summary && <p className="mt-2 text-sm">{summary}</p>}
            {verdict.checks.length > 0 && (
              <ul className="mt-3 space-y-2">
                {verdict.checks.map((check) => (
                  <li key={check.label} className="text-sm">
                    <span className="font-semibold">
                      {check.pass ? "Pass" : "Fail"} · {check.label}
                    </span>
                    <span className="block text-mute">{check.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              {verdict.diff.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {trace.length === 0 && status === "idle" && (
          <p className="text-sm text-mute">
            Pick a task and run it. The first connection to the supplier portal fails on purpose.
            Watch whether it retries, skips the draft, and stops for approval.
          </p>
        )}

        <ol className="space-y-3">
          {trace.map((entry) => (
            <li
              key={entry.id}
              className={cn(
                "trace-in border-l-4 bg-sheet px-3 py-3 shadow-card",
                entry.tone === "bad" && "border-copper",
                entry.tone === "good" && "border-ink",
                entry.tone === "neutral" && "border-transparent",
              )}
            >
              <p className="text-sm font-semibold">
                <span className="text-mute capitalize">{entry.kind}</span> · {entry.title}
              </p>
              <TraceBody body={entry.body} />
            </li>
          ))}
        </ol>

        {notes.length > 0 && (
          <div>
            <h3 className="font-display text-lg">Working notes</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}

        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer font-semibold">
            How this desk is built
          </summary>
          <div className="mt-2 space-y-3 text-mute">
            <p>
              The operator is a loop, not a script. Each turn model sees the goal, its notes, and
              what the tools actually returned. It chooses one next action. The desk carries that
              action out on the portal, the files, the ledger, the approval queue, or the exception
              log.
            </p>
            <p>
              Policy is enforced by the tools. A draft cannot be posted. A bill at or above
              ₹2,50,000 cannot be posted until you approve it. The weekly CSV is missing due dates
              and still lists the draft, so reading only the file is not enough.
            </p>
            <p>
              When it claims to be finished, a separate checker reads the books. It does not trust
              the summary. If the preset task is wrong, that failure goes back as an observation and
              it gets one more chance. All three tasks use the same loop.
            </p>
            <p>
              Simulated: the portal, the drive, and the ledger, for one fictional company. Not
              simulated: the choice of what to do next. A free-form goal runs the same loop, but
              only the three built-in tasks get a strict checker. Nothing is remembered after a
              reset. One run stops after ten model calls.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
