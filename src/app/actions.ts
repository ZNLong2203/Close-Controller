"use server";

import { revalidatePath } from "next/cache";
import { runReconciliation } from "@/lib/matching/pipeline";
import { decideException, type ReviewAction } from "@/lib/review";

/** The reviewer identity. A single-user demo, but the audit trail records it either way. */
const REVIEWER = process.env.CC_REVIEWER ?? "zkare";

export async function startRun(): Promise<void> {
  await runReconciliation("2026-08");
  revalidatePath("/");
  revalidatePath("/exceptions");
  revalidatePath("/audit");
}

export interface DecisionResult {
  ok: boolean;
  status: "resolved" | "dismissed" | "blocked";
  message: string;
}

export async function decide(
  exceptionId: string,
  action: ReviewAction,
  note?: string
): Promise<DecisionResult> {
  try {
    const outcome = decideException(exceptionId, action, REVIEWER, note);
    revalidatePath("/exceptions");
    revalidatePath("/audit");
    revalidatePath("/");
    return {
      // A policy block is a correct, expected outcome — not an error. The UI
      // renders it as a refusal with a reason, which is the whole point.
      ok: outcome.status !== "blocked",
      status: outcome.status,
      message: outcome.message,
    };
  } catch (e) {
    return { ok: false, status: "blocked", message: e instanceof Error ? e.message : String(e) };
  }
}
