import type { BankTxn, GlEntry } from "../types";

/**
 * Canonical forms used by every matcher. Kept pure and dependency-free so the
 * eval harness can unit-test them without touching the database.
 *
 * WORKER A owns this file.
 */

/** Strip bank noise ("ACH DEBIT", "WIRE OUT", trailing refs) down to a comparable vendor token. */
export function normalizeCounterparty(_raw: string): string {
  throw new Error("TODO(worker-a): normalizeCounterparty");
}

/** Pull invoice/PO references out of free-text descriptions, e.g. "INV-9001", "PO-4003". */
export function extractRefs(_text: string): string[] {
  throw new Error("TODO(worker-a): extractRefs");
}

/** 0..1 token-set similarity. Used for fuzzy vendor comparison. */
export function similarity(_a: string, _b: string): number {
  throw new Error("TODO(worker-a): similarity");
}

export function daysBetween(_a: string, _b: string): number {
  throw new Error("TODO(worker-a): daysBetween");
}

export type Side = { bank: BankTxn[]; gl: GlEntry[] };
