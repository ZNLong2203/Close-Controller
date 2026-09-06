/**
 * Scratch probe: prove the three audit exports survive hostile field content.
 *
 * Works on a throwaway copy of the database, into which it injects the values
 * that break naive CSV writers — commas, double quotes, CRLF and a leading
 * separator — into exactly the columns the exports quote least carefully: a
 * journal memo, an exception summary, a policy message. Every file is then
 * re-parsed with a strict RFC 4180 reader and compared byte-for-byte with the
 * database. A CSV an auditor's tooling cannot parse is not audit support.
 */
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC = process.env.CC_DB_PATH ?? join(process.cwd(), "close-controller.db");
const TMP = join(mkdtempSync(join(tmpdir(), "cc-probe-")), "close-controller.db");
// WAL mode keeps recent writes beside the main file; copy the sidecars too or
// the probe silently runs against a stale close.
for (const suffix of ["", "-wal", "-shm"]) {
  if (existsSync(SRC + suffix)) copyFileSync(SRC + suffix, TMP + suffix);
}
process.env.CC_DB_PATH = TMP;

const NASTY = 'Reconciliation "INV-9001", partial\r\nsettlement, see note';

/** Strict RFC 4180 reader: quoted fields may contain commas, CRLF and doubled quotes. */
function parseCsv(text: string): string[][] {
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r" && body[i + 1] === "\n") {
      row.push(field); field = ""; rows.push(row); row = []; i++; continue;
    }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  const { db } = await import("../src/lib/db");
  const d = db();
  const run = d.prepare(`SELECT id FROM run ORDER BY started_at DESC LIMIT 1`).get() as { id: string } | undefined;
  if (!run) { console.error("no run in the database — `npm run seed && npm run run:once` first"); process.exit(1); }

  // ── inject the hostile values ─────────────────────────────────────────────
  const je = d.prepare(`SELECT id FROM journal_entry WHERE run_id = ? LIMIT 1`).get(run.id) as { id: string };
  const exc = d.prepare(`SELECT id FROM exception WHERE run_id = ? LIMIT 1`).get(run.id) as { id: string };
  d.prepare(`UPDATE journal_entry SET memo = ? WHERE id = ?`).run(NASTY, je.id);
  d.prepare(`UPDATE exception SET summary = ?, resolution_note = ?, resolved_by = ? WHERE id = ?`)
    .run(NASTY, NASTY, "human:zkare", exc.id);
  d.prepare(
    `INSERT INTO policy_violation (run_id, subject_type, subject_id, rule_code, severity, message, created_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(run.id, "journal_entry", je.id, "PROBE_RULE", "block", NASTY, new Date().toISOString());
  d.prepare(
    `INSERT INTO audit_event (run_id, ts, actor, action, entity_type, entity_id, detail_json)
     VALUES (?,?,?,?,?,?,?)`
  ).run(run.id, new Date().toISOString(), "human:zkare", "review.note", "journal_entry", je.id,
        JSON.stringify({ note: NASTY, amountCents: -1845000, tags: ["a,b", 'c"d'] }));

  const routes = {
    audit: (await import("../src/app/api/export/audit/route")).GET,
    exceptions: (await import("../src/app/api/export/exceptions/route")).GET,
    journal: (await import("../src/app/api/export/journal/route")).GET,
  };

  for (const [name, GET] of Object.entries(routes)) {
    const res = await GET(new Request(`http://local/api/export/${name}?run=${run.id}`));
    const text = await res.text();
    const grid = parseCsv(text);
    const header = grid[0];
    const body = grid.slice(1);
    console.log(`\n${name}: ${body.length} rows x ${header.length} columns`);

    check(`${name} attachment filename`, /attachment; filename="close-[\w.-]+\.csv"/.test(res.headers.get("content-disposition") ?? ""),
      res.headers.get("content-disposition") ?? "missing");
    check(`${name} every row has ${header.length} fields`,
      body.every((r) => r.length === header.length),
      `worst row: ${Math.min(...body.map((r) => r.length))}`);
    check(`${name} no field lost its content`, body.length > 0);

    const col = (h: string) => header.indexOf(h);
    if (name === "journal") {
      const rows = body.filter((r) => r[col("je_id")] === je.id);
      check("journal memo round-trips exactly", rows.every((r) => r[col("memo")] === NASTY));
      check("journal block reason round-trips exactly", rows.every((r) => r[col("block_reason")] === NASTY));
      check("journal carries the blocking rule", rows.every((r) => r[col("blocked_by_rule")].includes("PROBE_RULE")));
      const blocked = body.filter((r) => r[col("status")] === "blocked");
      check("blocked entries are present", blocked.length > 0, `${blocked.length} rows`);
      check("every posted entry balances",
        body.filter((r) => r[col("status")] === "posted").every((r) => r[col("entry_balanced")] === "yes"));
      check("debits are integer cents",
        body.every((r) => r[col("debit_cents")] === "" || /^-?\d+$/.test(r[col("debit_cents")])));
    }
    if (name === "exceptions") {
      const row = body.find((r) => r[col("exception_id")] === exc.id)!;
      check("exception summary round-trips exactly", row[col("summary")] === NASTY);
      check("resolution and resolver are exported", row[col("resolution_note")] === NASTY && row[col("resolved_by")] === "human:zkare");
      check("category and severity are exported", Boolean(row[col("category")] && row[col("severity")]));
      const dbCount = (d.prepare(`SELECT COUNT(*) n FROM exception WHERE run_id=?`).get(run.id) as { n: number }).n;
      check("every exception is exported", body.length === dbCount, `${body.length} of ${dbCount}`);
    }
    if (name === "audit") {
      const row = body.find((r) => r[col("action")] === "review.note")!;
      check("audit detail is flattened into columns", row[col("detail.note")] === NASTY, header.includes("detail.note") ? "" : "no detail.note column");
      check("scalar arrays collapse into one cell", row[col("detail.tags")] === 'a,b; c"d');
      check("human and agent events are both present",
        new Set(body.map((r) => r[col("actor_kind")])).size > 1);
      const dbCount = (d.prepare(`SELECT COUNT(*) n FROM audit_event WHERE run_id=?`).get(run.id) as { n: number }).n;
      check("every event is exported", body.length === dbCount, `${body.length} of ${dbCount}`);
    }
  }

  console.log(failures === 0 ? "\nall export checks passed" : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
