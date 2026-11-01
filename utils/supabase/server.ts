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
  return createSupabaseClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    { accessToken: async () => token },
  );
};
