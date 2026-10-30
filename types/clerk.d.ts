export {};

declare global {
  // Custom claim added to the Clerk session token (Dashboard → Sessions), so the
  // organization's name is readable off the token without calling Clerk.
  interface CustomJwtSessionClaims {
    org_name?: string;
  }
}
