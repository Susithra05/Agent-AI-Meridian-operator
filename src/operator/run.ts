// The loop. Ask the model, run one tool, save what it returned, repeat.
// Pause when finance has to approve. Then check.ts decides if the job is done.
// The model never sees the screen, only the text in `transcript`.

import { create } from "zustand";
import { agentTurn } from "./client.ts";
import type { Decision, TurnResult } from "./decision.ts";
import { verifyOutcome } from "./check.ts";
import type { ScenarioId, Verdict } from "./check.ts";
import { applyTool, createWorld, decideApproval } from "./company.ts";
import type { World } from "./company.ts";

export type { ScenarioId };

export const JOBS = [
  {
    id: "post-latest" as const,
    label: "Post the latest invoice",
    blurb: "Helios → AP ledger",
    goal: "Find the latest invoice from Helios Components, extract the amount and due date, enter it into our internal AP ledger, and tell me once it is done. Follow company policy, including approvals.",
  },
  {
    id: "fieldglass" as const,
    label: "Check a receipt",
    blurb: "File it or flag it",
    goal: "A Fieldglass Logistics receipt is in the shared drive. Check it against company policy and either file it into the ledger or flag an exception. Do not file anything that breaks policy.",
  },
  {
    id: "reconcile" as const,
    label: "Reconcile Helios",
    blurb: "Report the gap. Don't post",
    goal: "Compare Helios Components invoices on the supplier portal with the AP ledger. Tell me which open invoices are not yet posted. Do not post or approve anything. Ignore drafts and anything already paid.",
  },
];

export function scenarioForGoal(goal: string): ScenarioId {
  return JOBS.find((job) => job.goal === goal.trim())?.id ?? "custom";
}

export type TraceKind =
  "understand" | "plan" | "execute" | "observe" | "adapt" | "verify" | "ask" | "complete";

export type TraceItem = {
  id: string;
  kind: TraceKind;
  title: string;
  body: string;
  tone: "neutral" | "bad" | "good";
};

export type RunStatus =
  "idle" | "running" | "awaiting_approval" | "awaiting_answer" | "done" | "stopped" | "error";

const MAX_CALLS = 10;

type DeskState = {
  world: World;
  startWorld: World;
  scenario: ScenarioId;
  goal: string;
  status: RunStatus;
  trace: TraceItem[];
  transcript: string[];
  notes: string[];
  verdict: Verdict | null;
  summary: string;
  error: string | null;
  modelCalls: number;
  verifyRetried: boolean;
  runToken: number;
  pendingQuestion: string | null;
  answerDraft: string;
  follow: boolean;
  portalFlakes: boolean;
  waiting: boolean;
  setGoal: (goal: string) => void;
  setFollow: (follow: boolean) => void;
  setPortalFlakes: (on: boolean) => void;
  setAnswerDraft: (value: string) => void;
  start: () => void;
  stop: () => void;
  reset: () => void;
  approve: () => void;
  reject: () => void;
  submitAnswer: () => void;
};

function item(
  kind: TraceKind,
  title: string,
  body: string,
  tone: TraceItem["tone"] = "neutral",
): TraceItem {
  return { id: crypto.randomUUID(), kind, title, body, tone };
}

function toolLine(decision: Decision): string {
  if (!decision.tool) return "";
  const args = Object.entries(decision.tool.args)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return `${decision.tool.name}(${args})`;
}

const initial = createWorld(1);
const openingGoal = JOBS[0]?.goal ?? "";

const PHASE_META: Record<Decision["phase"], { kind: TraceKind; title: string }> = {
  understand: { kind: "understand", title: "Understood" },
  plan: { kind: "plan", title: "Planning" },
  act: { kind: "execute", title: "Chosen action" },
  adapt: { kind: "adapt", title: "Changing approach" },
  ask: { kind: "ask", title: "Needs a person" },
  complete: { kind: "complete", title: "Claims it is done" },
};

export const useDesk = create<DeskState>((set, get) => {
  function append(trace: TraceItem[], transcriptLine?: string) {
    set((state) => ({
      trace: [...state.trace, ...trace],
      transcript: transcriptLine
        ? [...state.transcript, transcriptLine].slice(-20)
        : state.transcript,
    }));
  }

  async function loop(token: number) {
    while (get().runToken === token && get().status === "running") {
      if (get().modelCalls >= MAX_CALLS) {
        const verdict = verifyOutcome(get().scenario, get().startWorld, get().world, []);
        append([
          item(
            "verify",
            "Stopped at the call limit",
            verdict.gap || "Ten model calls is the cap for one run.",
            verdict.pass ? "good" : "bad",
          ),
        ]);
        set({ status: "done", verdict, waiting: false });
        return;
      }

      set({ waiting: true, modelCalls: get().modelCalls + 1 });
      let response: TurnResult;
      try {
        response = await agentTurn({
          goal: get().goal,
          notes: get().notes,
          history: get().transcript,
        });
      } catch (error) {
        if (get().runToken !== token) return;
        set({
          status: "error",
          waiting: false,
          error: error instanceof Error ? error.message : "The operator could not reach the model.",
        });
        return;
      }
      if (get().runToken !== token) return;
      set({ waiting: false });

      if (!response.ok) {
        set({ status: "error", error: response.error });
        return;
      }

      const decision = response.decision;
      const traces: TraceItem[] = [];
      const meta = PHASE_META[decision.phase];
      if (decision.rationale && decision.phase !== "complete") {
        traces.push(item(meta.kind, meta.title, decision.rationale));
      }
      if (decision.plan.length) {
        traces.push(
          item(
            "plan",
            "Steps",
            decision.plan.map((step, index) => `${index + 1}. ${step}`).join("\n"),
          ),
        );
      }
      const said = [
        `Agent phase=${decision.phase}: ${decision.rationale || "(no rationale)"}`,
        decision.tool ? `Tool ${toolLine(decision)}` : "",
        decision.summary ? `Summary: ${decision.summary}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      if (decision.tool) {
        traces.push(item("execute", decision.tool.name, toolLine(decision)));
        append(traces, said);
        const applied = applyTool(get().world, decision.tool.name, decision.tool.args);
        const bad =
          /TIMEOUT|NOT_FOUND|NEED_|DRAFT_|ALREADY_|AMOUNT_|DUE_|VENDOR_|GL_|APPROVAL_REQUIRED|APPROVAL_DENIED|POLICY_BLOCK|TRIP_|UNKNOWN_|NO_MATCH|NOT_A_|NO_INVOICES|NO_FILES/.test(
            applied.observation,
          );
        const tone = bad
          ? "bad"
          : /^(POSTED|FILED|FLAGGED|NOTED)/.test(applied.observation)
            ? "good"
            : "neutral";
        append(
          [item("observe", bad ? "Tool rejected" : "Observed", applied.observation, tone)],
          `World: ${applied.observation}`,
        );
        set({
          world: applied.world,
          notes: applied.remember ? [...get().notes, applied.remember].slice(-12) : get().notes,
        });
        if (applied.pause) {
          set({ status: "awaiting_approval" });
          return;
        }
        continue;
      }

      if (decision.phase === "ask" && decision.question) {
        traces.push(item("ask", "Needs a person", decision.question));
        append(traces, said);
        set({ status: "awaiting_answer", pendingQuestion: decision.question });
        return;
      }

      if (decision.phase === "complete") {
        const verdict = verifyOutcome(
          get().scenario,
          get().startWorld,
          get().world,
          decision.invoiceIds,
        );
        const tone = verdict.pass === false ? "bad" : verdict.pass ? "good" : "neutral";
        traces.push(
          item(
            "verify",
            verdict.mode === "diff" ? "Diff only" : verdict.pass ? "Verified" : "Not verified",
            verdict.mode === "diff"
              ? "Free-form goals have no strict checker. The record diff is the evidence."
              : verdict.checks
                  .map((check) => `${check.pass ? "Pass" : "Fail"} — ${check.label}`)
                  .join("\n"),
            tone,
          ),
        );
        if (verdict.pass === false && !get().verifyRetried) {
          append(traces, said);
          append(
            [item("adapt", "Checker sent it back", verdict.gap, "bad")],
            `World: ${verdict.gap}`,
          );
          set({ verifyRetried: true, summary: decision.summary ?? "" });
          continue;
        }
        traces.push(
          item(
            "complete",
            verdict.pass === false ? "Finished unverified" : verdict.pass ? "Done" : "Stopped",
            decision.summary || decision.rationale || "The operator stopped.",
            tone,
          ),
        );
        append(traces, said);
        set({ status: "done", verdict, summary: decision.summary ?? decision.rationale });
        return;
      }

      traces.push(
        item(
          "observe",
          "No action",
          "The operator did not call a tool. It needs to act or finish.",
          "bad",
        ),
      );
      append(traces, said);
      append(
        [],
        "World: NO_ACTION. Call exactly one tool, or complete with tool null after you have checked the records.",
      );
    }
  }

  function resume(token: number, observation: string) {
    append([item("observe", "A person answered", observation, "good")], `World: ${observation}`);
    set({ status: "running", pendingQuestion: null });
    void loop(token);
  }

  return {
    world: initial,
    startWorld: structuredClone(initial),
    scenario: "post-latest",
    goal: openingGoal,
    status: "idle",
    trace: [],
    transcript: [],
    notes: [],
    verdict: null,
    summary: "",
    error: null,
    modelCalls: 0,
    verifyRetried: false,
    runToken: 0,
    pendingQuestion: null,
    answerDraft: "",
    follow: true,
    portalFlakes: true,
    waiting: false,
    setGoal: (goal) => set({ goal, scenario: scenarioForGoal(goal) }),
    setFollow: (follow) => set({ follow }),
    setPortalFlakes: (portalFlakes) => set({ portalFlakes }),
    setAnswerDraft: (answerDraft) => set({ answerDraft }),
    start: () => {
      const { goal, portalFlakes, status } = get();
      if (!goal.trim() || status === "running") return;
      const token = get().runToken + 1;
      const startWorld = createWorld(portalFlakes ? 1 : 0);
      set({
        runToken: token,
        world: structuredClone(startWorld),
        startWorld,
        scenario: scenarioForGoal(goal),
        status: "running",
        trace: [item("understand", "Goal", goal.trim())],
        transcript: [],
        notes: [],
        verdict: null,
        summary: "",
        error: null,
        modelCalls: 0,
        verifyRetried: false,
        pendingQuestion: null,
        answerDraft: "",
        waiting: false,
      });
      void loop(token);
    },
    stop: () => {
      if (get().status === "idle" || get().status === "done") return;
      set((state) => ({ runToken: state.runToken + 1, status: "stopped", waiting: false }));
    },
    reset: () => {
      const startWorld = createWorld(get().portalFlakes ? 1 : 0);
      set((state) => ({
        runToken: state.runToken + 1,
        world: structuredClone(startWorld),
        startWorld,
        status: "idle",
        trace: [],
        transcript: [],
        notes: [],
        verdict: null,
        summary: "",
        error: null,
        modelCalls: 0,
        verifyRetried: false,
        pendingQuestion: null,
        answerDraft: "",
        waiting: false,
      }));
    },
    approve: () => {
      const token = get().runToken;
      if (get().status !== "awaiting_approval") return;
      const decided = decideApproval(get().world, "approved");
      set({ world: decided.world });
      resume(token, decided.observation);
    },
    reject: () => {
      const token = get().runToken;
      if (get().status !== "awaiting_approval") return;
      const decided = decideApproval(get().world, "rejected");
      set({ world: decided.world });
      resume(token, decided.observation);
    },
    submitAnswer: () => {
      const token = get().runToken;
      const answer = get().answerDraft.trim();
      if (get().status !== "awaiting_answer" || !answer) return;
      set({ answerDraft: "" });
      resume(token, `Human answered: ${answer}`);
    },
  };
});
