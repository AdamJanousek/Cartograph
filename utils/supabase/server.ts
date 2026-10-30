import { auth } from "@clerk/nextjs/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/utils/env";

// Supabase verifies the Clerk session token itself, so RLS policies can read
// the user and organization claims straight off it.
export const createClient = () =>
  createSupabaseClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    async accessToken() {
      return (await auth()).getToken();
    },
  });
