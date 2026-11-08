import { Client } from "langsmith";
import { wrapOpenAI } from "langsmith/wrappers/openai";
import OpenAI from "openai";

// The only place an AI client is constructed. Everything that talks to a model
// goes through `model()` and wraps its work in `traceable(work, traceAs(name))`, so every call, and
// every cache hit that avoids one, is a run in LangSmith.

// NVIDIA's hosted endpoint speaks the OpenAI API, so the OpenAI SDK (and
// LangSmith's wrapper for it) works unchanged against it.
const BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * Exact model ids, never a moving alias. NVIDIA publishes no dated snapshots,
 * so the full id is the most exact pin there is. Each name is part of its
 * cache key, so re-pinning one misses only its own cache.
 */
export const MODEL = {
  explain: "nvidia/nemotron-3.5-bolt-e4b",
  label: "nvidia/nemotron-3.5-bolt-e4b",
} as const;

/** Safe to hand to the browser: no key, only whether runs are being recorded. */
export type Tracing = { on: true; project: string } | { on: false; reason: string };

// Calls succeed either way. What must not happen is an absent key looking
// exactly like a working setup with no traffic, so the reason is kept and shown.
function readTracing(): Tracing {
  const flag = process.env.LANGSMITH_TRACING?.trim();
  if (flag !== "true") return { on: false, reason: "LANGSMITH_TRACING is not \"true\"" };
  if (!process.env.LANGSMITH_API_KEY?.trim()) return { on: false, reason: "LANGSMITH_API_KEY is not set" };
  return { on: true, project: process.env.LANGSMITH_PROJECT?.trim() || "default" };
}

export const tracing: Tracing = readTracing();
if (!tracing.on) console.warn(`AI calls are not being traced: ${tracing.reason}.`);

const langsmith = tracing.on ? new Client() : undefined;

let client: OpenAI | null = null;

/** The traced OpenAI client. Built on first use, so a missing key fails the call that needs it, not the app. */
export function model(): OpenAI {
  if (client) return client;
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) throw new Error("NVIDIA_API_KEY is not set in .env.local.");
  client = wrapOpenAI(new OpenAI({ baseURL: BASE_URL, apiKey }), { client: langsmith, tracingEnabled: tracing.on });
  return client;
}

/**
 * How a unit of AI work is traced: `traceable(work, traceAs("name"))`. The
 * cache read belongs inside `work`, so a hit is recorded as a run with no
 * model call in it. Called with `traceable` at each site rather than through
 * a generic wrapper, whose type langsmith can't resolve.
 */
export function traceAs(name: string) {
  return { name, run_type: "chain", client: langsmith, tracingEnabled: tracing.on } as const;
}

/** Waits for recorded runs to reach LangSmith; for after a response, or the end of a script. */
export async function flushTraces(): Promise<void> {
  await langsmith?.awaitPendingTraceBatches();
}

/** The text of a chat completion, or a loud failure when there isn't any. */
export function textOf(completion: OpenAI.Chat.Completions.ChatCompletion): string {
  const choice = completion.choices[0];
  const text = choice?.message.content?.trim();
  if (!text) throw new Error(`The model returned no text (finish reason: ${choice?.finish_reason ?? "none"}).`);
  return text;
}
