import { auth } from "@clerk/nextjs/server";

// Read on the server from the session token alone: the org id is a default
// claim and the name is a custom one, so nothing here calls Clerk.
export async function CurrentOrganization() {
  const { orgId, sessionClaims } = await auth();
  if (!orgId) return null;

  return (
    <span className="flex items-baseline gap-2">
      <span className="text-text">{sessionClaims?.org_name ?? orgId}</span>
      <span className="font-mono text-[11px] text-text-muted">{orgId}</span>
    </span>
  );
}
