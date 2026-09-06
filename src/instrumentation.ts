/**
 * Next.js calls this once, before any route module loads. Tracing has to be
 * initialised here rather than lazily, or the first close of a cold server
 * would go unrecorded.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initNeatlogs } = await import("@/lib/neatlogs");
  await initNeatlogs();
}
