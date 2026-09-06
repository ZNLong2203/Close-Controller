import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Span tracing. Writes a JSONL trace per run so latency and cost are measurable
 * offline, and optionally forwards spans to a collector (Neatlogs) when one is
 * configured.
 *
 * Forwarding is fire-and-forget by design: observability failing must never
 * fail a reconciliation run.
 */

const TRACE_DIR = join(process.cwd(), "data", "traces");
const INGEST_URL = process.env.NEATLOGS_INGEST_URL;
const INGEST_KEY = process.env.NEATLOGS_API_KEY;
const PROJECT = process.env.NEATLOGS_PROJECT ?? "close-controller";

export interface Span {
  end(output?: unknown, meta?: Record<string, unknown>): void;
}

export interface SpanRecord {
  traceId: string;
  name: string;
  startedAt: string;
  durationMs: number;
  input?: unknown;
  output?: unknown;
  meta?: Record<string, unknown>;
}

const spansByTrace = new Map<string, SpanRecord[]>();

export function startTrace(name: string, meta?: Record<string, unknown>): string {
  const traceId = `trace_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  spansByTrace.set(traceId, []);
  write(traceId, { traceId, name: `${name}.start`, startedAt: new Date().toISOString(), durationMs: 0, meta });
  return traceId;
}

export function span(traceId: string, name: string, input?: unknown): Span {
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  let closed = false;
  return {
    end(output?: unknown, meta?: Record<string, unknown>) {
      if (closed) return;
      closed = true;
      const rec: SpanRecord = { traceId, name, startedAt, durationMs: Date.now() - t0, input, output, meta };
      spansByTrace.get(traceId)?.push(rec);
      write(traceId, rec);
    },
  };
}

/** Spans recorded for a trace in this process. Used by the eval harness for latency percentiles. */
export const spansFor = (traceId: string): SpanRecord[] => spansByTrace.get(traceId) ?? [];

function write(traceId: string, rec: SpanRecord): void {
  try {
    mkdirSync(TRACE_DIR, { recursive: true });
    appendFileSync(join(TRACE_DIR, `${traceId}.jsonl`), JSON.stringify(rec) + "\n");
  } catch {
    /* tracing must never break a run */
  }
  if (INGEST_URL && INGEST_KEY) {
    void fetch(INGEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${INGEST_KEY}` },
      body: JSON.stringify({ project: PROJECT, ...rec }),
    }).catch(() => {});
  }
}
