import type { BankTxn, GlEntry } from "../types";

/**
 * Canonical forms used by every matcher. Pure and dependency-free so the eval
 * harness can exercise them without touching the database.
 */

/**
 * Tokens banks staple onto descriptions that carry no identifying signal.
 * Stripping them is what lets "ACH DEBIT NORTHWIND LOGISTICS INV-9001" and a
 * ledger memo of "Northwind Logistics INV-9001" compare as the same party.
 */
const BANK_NOISE = new Set([
  "ach", "debit", "credit", "wire", "out", "in", "inbound", "outbound",
  "deposit", "withdrawal", "payment", "pmt", "transfer", "xfer", "intl",
  "international", "domestic", "return", "reversal", "net", "of", "fee",
  "fees", "charge", "partial", "monthly", "recurring", "account", "acct",
  "maintenance", "settlement", "batch", "ref", "to", "from", "the",
]);

const REF_PATTERN = /\b(?:INV|PO|BILL|CR|DN)[-\s]?([A-Z0-9]{2,12})\b/gi;

/** Strip bank noise and references down to a comparable party token. */
export function normalizeCounterparty(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(REF_PATTERN, " ")
    .replace(/\d+\s*\/\s*\d+/g, " ")      // "1/2" leg markers
    .replace(/[^A-Za-z\s]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0 && !BANK_NOISE.has(t))
    .join(" ")
    .trim();
}

/** Pull invoice/PO references out of free text. Returns uppercase, de-duplicated. */
export function extractRefs(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(REF_PATTERN)) {
    const prefix = m[0].replace(/[-\s]?[A-Z0-9]{2,12}$/i, "").toUpperCase() || "INV";
    out.add(`${prefix.replace(/[-\s]/g, "")}-${m[1].toUpperCase()}`);
  }
  return [...out];
}

const tokens = (s: string) => normalizeCounterparty(s).split(/\s+/).filter(Boolean);

/**
 * 0..1 party similarity.
 *
 * Plain token overlap is not enough here: banks truncate counterparty names to a
 * fixed width, so "Adventure Works Travel" arrives as "ADVENTURE WO". We take the
 * better of Dice overlap and a prefix-aware containment score, and require a
 * substantive token to carry the match so short fragments cannot pair unrelated
 * vendors on their own.
 */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;

  const setA = new Set(ta);
  const setB = new Set(tb);
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;
  const dice = (2 * shared) / (setA.size + setB.size);

  // containment: every token of the shorter side prefix-matches the longer side
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  let hits = 0;
  let substantive = false;
  for (const s of short) {
    const hit = long.find((l) => l === s || (s.length >= 2 && l.startsWith(s)) || (l.length >= 2 && s.startsWith(l)));
    if (hit) {
      hits++;
      if (Math.max(s.length, hit.length) >= 4) substantive = true;
    }
  }
  const containment = substantive ? hits / short.length : 0;

  return Math.max(dice, containment);
}

export function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(a) - Date.parse(b));
  return Math.round(ms / 86_400_000);
}

/** Party text for a bank line: the explicit counterparty if present, else the description. */
export const bankParty = (t: BankTxn) => t.counterparty || t.description;
/** Party text for a ledger line: the explicit vendor if present, else the memo. */
export const glParty = (g: GlEntry) => g.vendor || g.memo;

/** All references attached to a bank line, from both the ref column and the description. */
export function bankRefs(t: BankTxn): string[] {
  const fromCol = t.external_ref ? extractRefs(t.external_ref).concat(t.external_ref.toUpperCase()) : [];
  return [...new Set([...fromCol, ...extractRefs(t.description)])];
}

export function glRefs(g: GlEntry): string[] {
  const fromCol = g.doc_ref ? extractRefs(g.doc_ref).concat(g.doc_ref.toUpperCase()) : [];
  return [...new Set([...fromCol, ...extractRefs(g.memo)])];
}

export type Side = { bank: BankTxn[]; gl: GlEntry[] };
