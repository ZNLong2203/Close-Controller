import { flush, init, wrapGoogleGenAI } from "neatlogs";
import type { GoogleGenAI } from "@google/genai";

/**
 * Neatlogs tracing for the model tier.
 *
 * Every Gemini call the reconciliation makes becomes a span with its prompt,
 * response, model and token usage, which is what makes a bad match debuggable
 * after the fact rather than only reproducible.
 *
 * Unconfigured, all of this is a no-op: a close must never fail because
 * observability is down, and the repo has to run for anyone who clones it
 * without a Neatlogs key.
 */

let started: Promise<boolean> | null = null;

export function neatlogsEnabled(): boolean {
  return Boolean(process.env.NEATLOGS_API_KEY);
}

/** Idempotent. Safe to call from every entry point — the app and each script. */
export function initNeatlogs(): Promise<boolean> {
  if (started) return started;
  if (!neatlogsEnabled()) {
    started = Promise.resolve(false);
    return started;
  }
  started = init({
    apiKey: process.env.NEATLOGS_API_KEY,
    workflowName: process.env.NEATLOGS_PROJECT ?? "close-controller",
    tags: ["close-controller", "reconciliation"],
  })
    .then(() => true)
    .catch((e) => {
      console.warn(`[neatlogs] init failed, continuing untraced: ${String(e)}`);
      return false;
    });
  return started;
}

/**
 * Wraps a Gemini client so its calls are traced. Returns the client untouched
 * when tracing is off, so callers never branch on it.
 */
export function traceGemini(client: GoogleGenAI): GoogleGenAI {
  if (!neatlogsEnabled()) return client;
  try {
    return wrapGoogleGenAI(client) as GoogleGenAI;
  } catch (e) {
    console.warn(`[neatlogs] could not wrap the Gemini client: ${String(e)}`);
    return client;
  }
}

/**
 * Spans are batched, so a short-lived CLI process exits before they are sent.
 * Long-running servers do not need this.
 */
export async function flushNeatlogs(): Promise<void> {
  if (!neatlogsEnabled()) return;
  try {
    await flush();
  } catch {
    /* never fail a close on a flush */
  }
}
