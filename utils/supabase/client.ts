"use client";

import { useSession } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import { publicEnv } from "@/utils/env";

// Browser client authenticated with the current Clerk session token.
export const useSupabase = () => {
  const { session } = useSession();

  return useMemo(
    () =>
      createClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
        async accessToken() {
          return (await session?.getToken()) ?? null;
        },
      }),
    [session],
  );
};
