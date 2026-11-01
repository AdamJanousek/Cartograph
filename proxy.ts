import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";

// /preview renders checked-in parser output and holds no one's data; it goes
// away with the scaffolding behind it.
const PUBLIC_PREFIXES = ["/sign-in", "/sign-up", "/preview"];

function isPublic(req: NextRequest) {
  const { pathname } = req.nextUrl;
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// Protection lives here rather than in pages on purpose. With Cache Components a
// page streams its static shell before any check inside it runs, so a redirect
// from the page would arrive after HTML had already been sent. Here a signed-out
// request is redirected before rendering starts. Everything is protected except
// the auth screens and the preview.
export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
