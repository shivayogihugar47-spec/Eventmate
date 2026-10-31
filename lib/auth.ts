/**
 * Neon Auth helpers
 *
 * Neon Auth is Managed Better Auth. It injects two env vars:
 *   NEON_AUTH_BASE_URL  – Auth server base URL (includes database path segment)
 *   NEON_AUTH_JWKS_URL  – JWKS endpoint for verifying tokens server-side
 *
 * The app installs @neondatabase/auth which wraps Better Auth's client methods
 * (signIn.email, getSession, etc.) and handles iframe-popup OAuth, JWT
 * provisioning, and Neon-specific OAuth verifier — do NOT use bare better-auth/client.
 *
 * TODO: Install @neondatabase/auth when you add a login UI:
 *   npm install @neondatabase/auth
 *
 * Then initialise the client (client-side only):
 *   import { createAuthClient } from "@neondatabase/auth";
 *   export const authClient = createAuthClient({
 *     baseURL: process.env.NEXT_PUBLIC_NEON_AUTH_BASE_URL,
 *   });
 *
 * For server-side JWT verification (e.g. in API routes / Neon Functions):
 *   import { createRemoteJWKSet, jwtVerify } from "jose";
 *   const jwks = createRemoteJWKSet(new URL(process.env.NEON_AUTH_JWKS_URL!));
 *   const issuer = new URL(process.env.NEON_AUTH_BASE_URL!).origin;
 *   const { payload } = await jwtVerify(token, jwks, { issuer });
 */

/** Auth configuration read from environment. */
export const authConfig = {
  /** Auth server base URL – present when Neon Auth is enabled on the branch. */
  baseUrl: process.env.NEON_AUTH_BASE_URL ?? "",

  /** JWKS endpoint for server-side token verification. */
  jwksUrl: process.env.NEON_AUTH_JWKS_URL ?? "",

  /** Whether auth env vars are present and non-empty. */
  get isConfigured(): boolean {
    return Boolean(this.baseUrl && this.jwksUrl);
  },
} as const;
