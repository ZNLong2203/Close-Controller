import { NextResponse } from "next/server";
import { z } from "zod";
import { CsvSchema, KindSchema, MappingSchema, buildPreview } from "@/lib/import/preview";

export const runtime = "nodejs";

const Body = z.object({ kind: KindSchema, csv: CsvSchema, mapping: MappingSchema });

/**
 * The rows exactly as they would be inserted, plus everything that failed.
 * Still writes nothing: the user has not confirmed yet.
 */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body is not JSON." }, { status: 400 });
  }

  const body = Body.safeParse(json);
  if (!body.success) {
    return NextResponse.json({ error: "Expected { kind, csv, mapping }." }, { status: 400 });
  }

  const { payload } = buildPreview(body.data.csv, body.data.mapping, body.data.kind);
  return NextResponse.json(payload);
}
