/**
 * Neatlogs tracing (hackathon partner). Degrades to a no-op when unconfigured
 * so the pipeline never fails because observability is missing.
 *
 * WORKER B owns the real implementation.
 */
export interface Span {
  end(output?: unknown, meta?: Record<string, unknown>): void;
}

export function startTrace(_name: string, _meta?: Record<string, unknown>): string {
  return `trace_${Date.now().toString(36)}`;
}

export function span(_traceId: string, _name: string, _input?: unknown): Span {
  return { end: () => {} };
}
