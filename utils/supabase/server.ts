import { auth } from "@clerk/nextjs/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { publicEnv } from "@/utils/env";

// Supabase verifies the Clerk session token itself, so RLS policies can read
// the user and organization claims straight off it.
//
// The token is read before the client exists, not lazily inside accessToken:
// supabase-js calls accessToken eagerly at construction to prime Realtime,
// outside the render, and during prerender that request-time read rejects.
// Awaiting it here keeps the read inside the render that needs it.
export const createClient = async () => {
  const token = await (await auth()).getToken();
  return clientFor(token);
};

// How long a run may write for. A run outlives the request that started it,
// and that request's session token expires about a minute in, so the run gets
// its own: still a session token for the same user and organization, so every
// write passes the same policies a read does. A run that overruns this fails
// to write, and shows up as stale rather than wrong.
const RUN_TOKEN_SECONDS = 10 * 60;

export const createRunClient = async () => {
  const token = await (await auth()).getToken({ expiresInSeconds: RUN_TOKEN_SECONDS });
  if (!token) throw new Error("Not signed in.");
  return clientFor(token);
};

function clientFor(token: string | null) {
  return createSupabaseClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    { accessToken: async () => token },
  );
}

export type Client = ReturnType<typeof clientFor>;
