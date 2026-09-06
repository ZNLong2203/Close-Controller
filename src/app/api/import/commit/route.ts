import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ingest } from "@/lib/import/ingest";
import { CsvSchema, MappingSchema, buildPreview } from "@/lib/import/preview";
import type { BankDraft, GlDraft } from "@/lib/import/transform";

export const runtime = "nodejs";

const REVIEWER = process.env.CC_REVIEWER ?? "zkare";

const Side = z.object({ csv: CsvSchema, mapping: MappingSchema, filename: z.string().max(300).default("upload.csv") });

const Body = z.object({
  bank: Side.nullish(),
  ledger: Side.nullish(),
  replaceExisting: z.boolean().default(true),
});

/**
 * The confirm step. Re-runs the transform server-side rather than trusting rows
 * the browser sends back — the preview is a view, not an authority.
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
    return NextResponse.json({ error: "Expected { bank?, ledger?, replaceExisting }." }, { status: 400 });
  }
  const { bank, ledger, replaceExisting } = body.data;
  if (!bank && !ledger) {
    return NextResponse.json({ error: "Nothing to import — upload a bank statement, a ledger export, or both." }, { status: 400 });
  }

  const bankSide = bank ? buildPreview(bank.csv, bank.mapping, "bank") : null;
  const ledgerSide = ledger ? buildPreview(ledger.csv, ledger.mapping, "ledger") : null;

  // A file where nothing survived the transform is a mapping error, not an
  // import. Writing zero rows and reporting success would hide that.
  for (const [label, side] of [["bank statement", bankSide], ["ledger export", ledgerSide]] as const) {
    if (side && side.result.rows.length === 0) {
      return NextResponse.json(
        {
          error: `Every row in the ${label} was rejected (${side.result.rejected.length} of ${side.payload.totalRows}). Check the column mapping — nothing was written.`,
          rejected: side.payload.rejected,
        },
        { status: 422 }
      );
    }
  }

  const result = ingest({
    replaceExisting,
    actor: REVIEWER,
    bank: bankSide
      ? {
          rows: bankSide.result.rows as BankDraft[],
          source: bank!.filename,
          rejectedCount: bankSide.result.rejected.length,
        }
      : null,
    ledger: ledgerSide
      ? {
          rows: ledgerSide.result.rows as GlDraft[],
          source: ledger!.filename,
          rejectedCount: ledgerSide.result.rejected.length,
        }
      : null,
  });

  revalidatePath("/");
  revalidatePath("/import");
  revalidatePath("/exceptions");
  revalidatePath("/audit");

  return NextResponse.json({
    ok: true,
    batchId: result.batchId,
    bankInserted: result.bankInserted,
    glInserted: result.glInserted,
    bankRejected: bankSide?.result.rejected.length ?? 0,
    ledgerRejected: ledgerSide?.result.rejected.length ?? 0,
    replaced: result.cleared,
    period: result.period,
  });
}
