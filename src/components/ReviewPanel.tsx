"use client";

import { useState, useTransition } from "react";
import { decide, type DecisionResult } from "@/app/actions";
import type { ReviewAction } from "@/lib/review";

interface Props {
  exceptionId: string;
  /** post_anyway is offered only where there is a pair to force and no proposal to approve. */
  canApprove: boolean;
  canForce: boolean;
  status: string;
}

const BUTTONS: { action: ReviewAction; label: string; hint: string; kind: "primary" | "quiet" | "danger" }[] = [
  { action: "approve", label: "Approve & post", hint: "Accept the pairing and book the entry", kind: "primary" },
  { action: "reject", label: "Reject pairing", hint: "Wrong candidate; return both sides to the queue", kind: "quiet" },
  { action: "dismiss", label: "Dismiss", hint: "Acknowledged, no entry required", kind: "quiet" },
  { action: "post_anyway", label: "Post anyway", hint: "Override the system's advice", kind: "danger" },
];

export function ReviewPanel({ exceptionId, canApprove, canForce, status }: Props) {
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [pending, start] = useTransition();

  if (status !== "open" && !result) {
    return (
      <div className="rounded-md border border-border bg-bg px-3 py-2 text-[12px] text-muted">
        Closed as <strong className="text-text">{status}</strong>.
      </div>
    );
  }

  const available = BUTTONS.filter((b) =>
    b.action === "approve" ? canApprove : b.action === "post_anyway" ? canForce : true
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {available.map((b) => (
          <button
            key={b.action}
            title={b.hint}
            disabled={pending}
            onClick={() =>
              start(async () => {
                setResult(await decide(exceptionId, b.action));
              })
            }
            className={
              "rounded-md px-3 py-1.5 text-[12px] font-medium transition-opacity disabled:opacity-50 " +
              (b.kind === "primary"
                ? "bg-accent text-panel hover:opacity-90"
                : b.kind === "danger"
                  ? "border border-danger/40 text-danger hover:bg-danger-soft"
                  : "border border-border hover:bg-bg")
            }
          >
            {pending ? "…" : b.label}
          </button>
        ))}
      </div>

      {result && (
        <div
          className={
            "rounded-md border px-3 py-2.5 text-[13px] leading-relaxed " +
            (result.status === "blocked"
              ? "border-danger/50 bg-danger-soft text-danger"
              : "border-accent/40 bg-accent-soft text-accent")
          }
        >
          <div className="text-[11px] font-semibold uppercase tracking-widest">
            {result.status === "blocked" ? "Refused by policy" : result.status}
          </div>
          <div className="mt-1 text-text">{result.message}</div>
        </div>
      )}
    </div>
  );
}
