"use client";

import { useTransition } from "react";
import { startRun } from "@/app/actions";

/**
 * A close takes ten seconds or so. Without a pending state the button reads as
 * frozen, which is the worst thing it can do while someone is watching.
 */
export function RunButton({ label = "Run reconciliation", variant = "primary" }: { label?: string; variant?: "primary" | "quiet" }) {
  const [pending, start] = useTransition();

  return (
    <button
      onClick={() => start(() => startRun())}
      disabled={pending}
      aria-busy={pending}
      className={
        "inline-flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-medium transition-opacity disabled:cursor-wait " +
        (variant === "primary"
          ? "bg-accent text-panel hover:opacity-90 disabled:opacity-80"
          : "border border-border bg-panel hover:bg-accent-soft disabled:opacity-60")
      }
    >
      {pending && (
        <span
          aria-hidden
          className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
        />
      )}
      {pending ? "Reconciling…" : label}
    </button>
  );
}
