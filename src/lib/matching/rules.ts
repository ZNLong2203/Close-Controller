import type { BankTxn, EvidenceItem, GlEntry, MatchProposal } from "../types";
import {
  bankParty, bankRefs, daysBetween, glParty, glRefs, similarity, type Side,
} from "./normalize";

/**
 * Deterministic matching, in passes ordered most-certain first. Each pass only
 * sees what earlier passes left behind.
 *
 * This tier carries the volume, and that is the whole cost argument: every pair
 * resolved here is a pair the model never has to think about.
 */

export interface RuleResult {
  proposals: MatchProposal[];
  residue: { bankIds: string[]; glIds: string[] };
}

/** Amounts this close are the same payment; the gap is a fee or a rounding artefact. */
const AMOUNT_TOLERANCE_PCT = 0.02;
const AMOUNT_TOLERANCE_ABS = 15_000; // $150 in cents
/** Plausible band for the same obligation settled in another currency. */
const FX_BAND = [0.6, 1.8] as const;
const FUZZY_DATE_WINDOW = 5;
const FUZZY_PARTY_FLOOR = 0.8;

const money = (c: number) => `${c < 0 ? "-" : ""}$${Math.abs(c / 100).toFixed(2)}`;

function ev(label: string, excerpt: string, source_uri?: string): EvidenceItem {
  return source_uri ? { label, excerpt, source_uri } : { label, excerpt };
}

const bankEv = (t: BankTxn) =>
  ev(`Bank ${t.id}`, `${t.posted_on} · ${money(t.amount_cents)} ${t.currency} · ${t.description}`);
const glEv = (g: GlEntry) =>
  ev(`Ledger ${g.id}`, `${g.booked_on} · ${money(g.amount_cents)} ${g.currency} · ${g.account_code} · ${g.memo}`);

function propose(
  bank: BankTxn[], gl: GlEntry[], confidence: number,
  method: MatchProposal["method"], reasoning: string, extra: EvidenceItem[] = []
): MatchProposal {
  return {
    kind: "bank_gl",
    bankTxnIds: bank.map((b) => b.id),
    glEntryIds: gl.map((g) => g.id),
    confidence, method, reasoning,
    evidence: [...bank.map(bankEv), ...gl.map(glEv), ...extra],
  };
}

const amountsClose = (a: number, b: number) => {
  const diff = Math.abs(Math.abs(a) - Math.abs(b));
  return diff <= Math.max(AMOUNT_TOLERANCE_ABS, Math.abs(a) * AMOUNT_TOLERANCE_PCT);
};

const inFxBand = (a: number, b: number) => {
  const r = Math.abs(a) / Math.abs(b || 1);
  return r >= FX_BAND[0] && r <= FX_BAND[1];
};

const sameSign = (a: number, b: number) => a === 0 || b === 0 || a > 0 === b > 0;

export function runRuleMatchers(side: Side): RuleResult {
  const proposals: MatchProposal[] = [];
  const usedBank = new Set<string>();
  const usedGl = new Set<string>();
  const take = (b: BankTxn[], g: GlEntry[]) => {
    b.forEach((x) => usedBank.add(x.id));
    g.forEach((x) => usedGl.add(x.id));
  };
  const freeBank = () => side.bank.filter((b) => !usedBank.has(b.id));
  const freeGl = () => side.gl.filter((g) => !usedGl.has(g.id));

  // ── Pass 1 · shared reference ───────────────────────────────────────────────
  // A reference appearing on both sides is the strongest signal available, but
  // it is also where duplicates and partial payments hide. Both look like "one
  // ledger entry, several bank legs" and they must not be confused: a partial
  // pair sums to the bill, a duplicate pair each *equals* it.
  const byRef = new Map<string, { bank: BankTxn[]; gl: GlEntry[] }>();
  const bucket = (r: string) => {
    let b = byRef.get(r);
    if (!b) byRef.set(r, (b = { bank: [], gl: [] }));
    return b;
  };
  for (const t of side.bank) for (const r of bankRefs(t)) bucket(r).bank.push(t);
  for (const g of side.gl) for (const r of glRefs(g)) bucket(r).gl.push(g);

  for (const [ref, grp] of byRef) {
    const bank = grp.bank.filter((b) => !usedBank.has(b.id)).sort((a, b) => a.posted_on.localeCompare(b.posted_on));
    const gl = grp.gl.filter((g) => !usedGl.has(g.id));
    if (gl.length !== 1 || bank.length === 0) continue;
    const g = gl[0];
    const refEv = ev("Shared reference", `${ref} appears on both the bank line and the ledger entry`);

    if (bank.length === 1) {
      const b = bank[0];
      if (b.currency !== g.currency && inFxBand(b.amount_cents, g.amount_cents)) {
        proposals.push(propose([b], [g], 0.88, "rule_exact",
          `Reference ${ref} matches across currencies (${g.currency} bill settled in ${b.currency}). Rate implied ${(Math.abs(b.amount_cents) / Math.abs(g.amount_cents)).toFixed(4)}.`,
          [refEv, ev("FX variance", `${money(g.amount_cents)} ${g.currency} settled as ${money(b.amount_cents)} ${b.currency}`)]));
        take([b], [g]);
      } else if (b.amount_cents === g.amount_cents) {
        proposals.push(propose([b], [g], 0.99, "rule_exact",
          `Reference ${ref} on both sides, amounts identical to the cent.`, [refEv]));
        take([b], [g]);
      } else if (sameSign(b.amount_cents, g.amount_cents) && amountsClose(b.amount_cents, g.amount_cents)) {
        const diff = Math.abs(g.amount_cents) - Math.abs(b.amount_cents);
        proposals.push(propose([b], [g], 0.92, "rule_exact",
          `Reference ${ref} on both sides. Settled ${money(Math.abs(diff))} short of the ledger amount, consistent with a netted bank fee.`,
          [refEv, ev("Amount variance", `Ledger ${money(g.amount_cents)} vs bank ${money(b.amount_cents)} — gap ${money(Math.abs(diff))}`)]));
        take([b], [g]);
      }
      continue;
    }

    // several bank legs against one ledger entry
    const allFull = bank.every((b) => b.amount_cents === g.amount_cents);
    const sum = bank.reduce((s, b) => s + b.amount_cents, 0);

    if (allFull) {
      // Duplicate payment. Settle the earliest leg and deliberately leave the
      // rest unmatched — the exception builder turns them into duplicate_suspect.
      const [first] = bank;
      proposals.push(propose([first], [g], 0.95, "rule_exact",
        `Reference ${ref} settled by the ${first.posted_on} payment. ${bank.length - 1} further payment(s) carry the same reference and the same amount — left unmatched for duplicate review.`,
        [refEv, ev("Duplicate signal", bank.slice(1).map((b) => `${b.id} ${b.posted_on} ${money(b.amount_cents)}`).join(" · "))]));
      take([first], [g]);
      continue;
    }

    if (sum === g.amount_cents && bank.length > 1) {
      proposals.push(propose(bank, [g], 0.95, "rule_exact",
        `Reference ${ref} settled by ${bank.length} partial payments summing exactly to ${money(g.amount_cents)}.`,
        [refEv, ev("Partial settlement", bank.map((b) => `${b.posted_on} ${money(b.amount_cents)}`).join(" + "))]));
      take(bank, [g]);
    }
  }

  // ── Pass 2 · same day, identical amount, same party ─────────────────────────
  for (const b of freeBank()) {
    const g = freeGl().find(
      (g) =>
        g.amount_cents === b.amount_cents &&
        g.currency === b.currency &&
        g.booked_on === b.posted_on &&
        similarity(bankParty(b), glParty(g)) >= FUZZY_PARTY_FLOOR
    );
    if (!g) continue;
    proposals.push(propose([b], [g], 0.95, "rule_exact",
      `Same posting date, identical amount, and the counterparty resolves to the same party.`,
      [ev("Party", `"${bankParty(b)}" ≈ "${glParty(g)}"`)]));
    take([b], [g]);
  }

  // ── Pass 3 · one-to-many without a shared reference ─────────────────────────
  // Bounded deliberately: same party, same currency, within a fortnight, at most
  // three legs. Subset-sum is only tractable because the candidate window is small.
  for (const g of freeGl()) {
    const legs = freeBank().filter(
      (b) =>
        b.currency === g.currency &&
        sameSign(b.amount_cents, g.amount_cents) &&
        daysBetween(b.posted_on, g.booked_on) <= 14 &&
        similarity(bankParty(b), glParty(g)) >= FUZZY_PARTY_FLOOR
    ).slice(0, 8);
    if (legs.length < 2) continue;

    const combo = findSubset(legs, g.amount_cents, 3);
    if (!combo) continue;
    proposals.push(propose(combo, [g], 0.85, "rule_fuzzy",
      `${combo.length} same-party payments sum exactly to the ledger amount within a two-week window.`,
      [ev("Legs", combo.map((b) => `${b.posted_on} ${money(b.amount_cents)}`).join(" + "))]));
    take(combo, [g]);
  }

  // ── Pass 4 · fuzzy single pairs ─────────────────────────────────────────────
  // Timing differences and netted fees. Confidence scales with how good the
  // agreement actually is rather than being a flat constant, so the gate can do
  // something useful with it.
  for (const b of freeBank()) {
    let best: { g: GlEntry; score: number; days: number; sim: number } | null = null;
    for (const g of freeGl()) {
      if (!sameSign(b.amount_cents, g.amount_cents)) continue;
      const days = daysBetween(b.posted_on, g.booked_on);
      if (days > FUZZY_DATE_WINDOW) continue;
      const crossCcy = b.currency !== g.currency;
      if (crossCcy ? !inFxBand(b.amount_cents, g.amount_cents) : !amountsClose(b.amount_cents, g.amount_cents)) continue;
      const sim = similarity(bankParty(b), glParty(g));
      if (sim < FUZZY_PARTY_FLOOR) continue;

      const exactAmt = b.amount_cents === g.amount_cents;
      const score = 0.70 + (exactAmt ? 0.12 : 0) + sim * 0.1 + (1 - days / (FUZZY_DATE_WINDOW + 1)) * 0.06;
      if (!best || score > best.score) best = { g, score: Math.min(score, 0.94), days, sim };
    }
    if (!best) continue;
    const { g, score, days, sim } = best;
    const exactAmt = b.amount_cents === g.amount_cents;
    proposals.push(propose([b], [g], round2(score), "rule_fuzzy",
      exactAmt
        ? `Identical amount and the same party, cleared ${days} day(s) after it was booked — a timing difference.`
        : `Same party within ${days} day(s); amounts differ by ${money(Math.abs(Math.abs(g.amount_cents) - Math.abs(b.amount_cents)))}.`,
      [ev("Party", `"${bankParty(b)}" ≈ "${glParty(g)}" (similarity ${sim.toFixed(2)})`)]));
    take([b], [g]);
  }

  return {
    proposals,
    residue: { bankIds: freeBank().map((b) => b.id), glIds: freeGl().map((g) => g.id) },
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Smallest subset of `legs` (size 2..maxSize) summing exactly to `target`. */
function findSubset(legs: BankTxn[], target: number, maxSize: number): BankTxn[] | null {
  for (let size = 2; size <= Math.min(maxSize, legs.length); size++) {
    const found = walk(legs, target, size, 0, []);
    if (found) return found;
  }
  return null;
}

function walk(legs: BankTxn[], target: number, size: number, start: number, acc: BankTxn[]): BankTxn[] | null {
  if (acc.length === size) {
    return acc.reduce((s, b) => s + b.amount_cents, 0) === target ? [...acc] : null;
  }
  for (let i = start; i < legs.length; i++) {
    acc.push(legs[i]);
    const hit = walk(legs, target, size, i + 1, acc);
    acc.pop();
    if (hit) return hit;
  }
  return null;
}
