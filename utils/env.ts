// A missing or blank value crashes on boot with its name, rather than surfacing
// later as an anonymous client or a confusing redirect.
function required(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(`Missing environment variable ${name}. Set it in .env.local.`);
  }
  return value;
}

// Each NEXT_PUBLIC_ read is written out literally so Next can inline it into
// the browser bundle.
export const publicEnv = {
  clerkPublishableKey: required(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  ),
  clerkSignInUrl: required(
    "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
    process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
  ),
  clerkSignUpUrl: required(
    "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
    process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL,
  ),
  clerkSignInFallbackRedirectUrl: required(
    "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL",
    process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL,
  ),
  clerkSignUpFallbackRedirectUrl: required(
    "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL",
    process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL,
  ),
  supabaseUrl: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  supabasePublishableKey: required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
};

// Server-only values are checked but never exported, so importing this module
// from client code can't leak them. Clerk reads the secret key itself.
export function assertServerEnv(): void {
  required("CLERK_SECRET_KEY", process.env.CLERK_SECRET_KEY);
}
