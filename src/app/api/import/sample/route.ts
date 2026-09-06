import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { KindSchema } from "@/lib/import/preview";

export const runtime = "nodejs";

/**
 * Serves the two CSVs in `data/samples/` so the flow can be demonstrated
 * without a real statement to hand. Read-only, and the filename is not taken
 * from the request — only the two names below are reachable.
 */
const FILES = {
  bank: "bank_statement_sample.csv",
  ledger: "general_ledger_sample.csv",
} as const;

export async function GET(req: Request) {
  const kind = KindSchema.safeParse(new URL(req.url).searchParams.get("kind"));
  if (!kind.success) return NextResponse.json({ error: "kind must be bank or ledger" }, { status: 400 });

  const filename = FILES[kind.data];
  try {
    const csv = readFileSync(join(process.cwd(), "data", "samples", filename), "utf8");
    return NextResponse.json({ filename, csv });
  } catch {
    return NextResponse.json({ error: `data/samples/${filename} is not present in this checkout.` }, { status: 404 });
  }
}
