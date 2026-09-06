import { NextResponse } from "next/server";
import { z } from "zod";
import { CsvSchema, KindSchema, MAX_CSV_BYTES, inspect } from "@/lib/import/preview";

export const runtime = "nodejs";

const Body = z.object({ kind: KindSchema, csv: CsvSchema });

/** Header row + a first guess at the mapping. Reads nothing, writes nothing. */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body is not JSON." }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    const tooBig = JSON.stringify(json).length > MAX_CSV_BYTES;
    return NextResponse.json(
      { error: tooBig ? `File is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB.` : "Expected { kind, csv }." },
      { status: tooBig ? 413 : 400 }
    );
  }

  const out = inspect(parsed.data.csv, parsed.data.kind);
  if (!out.headers.length) {
    return NextResponse.json({ error: "No header row found — the file appears to be empty." }, { status: 422 });
  }
  return NextResponse.json(out);
}
