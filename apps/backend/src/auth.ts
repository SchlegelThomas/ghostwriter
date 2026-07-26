import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  ghostwriterSchema,
  type RepositoryDatabase
} from "@ghostwriter/storage";
import { betterAuth } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import {
  pagesPreviewCookieDomain,
  type BackendConfig
} from "./config.js";
import { DEMO_SEED_ACCOUNT, deriveDemoSeedPassword } from "./demo-identity.js";

export type AuthenticatedAccount = Readonly<{
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}>;

export type AuthenticatedSession = Readonly<{
  account: AuthenticatedAccount;
  session: Readonly<{
    id: string;
    expiresAt: string;
  }>;
}>;

export interface AuthGateway {
  handler(request: Request): Response | Promise<Response>;
  getSession(headers: Headers): Promise<AuthenticatedSession | null>;
  /** Idempotently ensures the fixed demo user + credential account exist. */
  ensureDemoCredentialAccount(): Promise<void>;
  /**
   * Signs in the demo seed account via Better Auth email/password and returns a
   * response that includes session `Set-Cookie` headers. Never exposes the password.
   */
  signInDemo(request: Request): Promise<Response>;
}

function copySetCookieHeaders(from: Headers, to: Headers): void {
  const multi =
    typeof from.getSetCookie === "function" ? from.getSetCookie() : undefined;
  if (multi !== undefined && multi.length > 0) {
    for (const cookie of multi) {
      to.append("set-cookie", cookie);
    }
    return;
  }
  const single = from.get("set-cookie");
  if (single !== null && single.length > 0) {
    to.append("set-cookie", single);
  }
}

export function createBetterAuthGateway(
  db: RepositoryDatabase,
  config: BackendConfig["auth"]
): AuthGateway {
  const previewCookieDomain = pagesPreviewCookieDomain(config.baseUrl);
  const auth = betterAuth({
    appName: "Ghostwriter",
    baseURL: config.baseUrl,
    secret: config.secret,
    trustedOrigins: [...config.trustedOrigins],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: ghostwriterSchema
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true
    },
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret
      }
    },
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: "database",
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false
      }
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 60 * 24
    },
    advanced: {
      cookiePrefix: "ghostwriter",
      useSecureCookies: config.secureCookies,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      // Branch previews are subdomains of the Pages project host. Keep Google's
      // redirect on the canonical Pages origin, then share the session cookie.
      ...(previewCookieDomain === undefined
        ? {}
        : {
            crossSubDomainCookies: {
              enabled: true,
              domain: previewCookieDomain
            }
          }),
      defaultCookieAttributes: {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: "lax",
        path: "/"
      }
    },
    rateLimit: {
      enabled: true,
      window: 10,
      max: 100,
      storage: "memory"
    }
  });

  return Object.freeze({
    handler(request: Request): Response | Promise<Response> {
      return auth.handler(request);
    },
    async getSession(headers: Headers): Promise<AuthenticatedSession | null> {
      const result = await auth.api.getSession({ headers });

      if (result === null) return null;

      return Object.freeze({
        account: Object.freeze({
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          emailVerified: result.user.emailVerified
        }),
        session: Object.freeze({
          id: result.session.id,
          expiresAt: result.session.expiresAt.toISOString()
        })
      });
    },
    async ensureDemoCredentialAccount(): Promise<void> {
      const ctx = await auth.$context;
      const hashed = await hashPassword(deriveDemoSeedPassword(config.secret));

      const existingById = await ctx.internalAdapter.findUserById(
        DEMO_SEED_ACCOUNT.id
      );
      if (existingById === null) {
        const existingByEmail = await ctx.internalAdapter.findUserByEmail(
          DEMO_SEED_ACCOUNT.email
        );
        if (existingByEmail !== null) {
          throw new Error(
            "Demo seed email is already owned by a different account id."
          );
        }
        await ctx.internalAdapter.createUser({
          id: DEMO_SEED_ACCOUNT.id,
          email: DEMO_SEED_ACCOUNT.email,
          name: DEMO_SEED_ACCOUNT.name,
          emailVerified: true
        });
      }

      const accounts = await ctx.internalAdapter.findAccounts(DEMO_SEED_ACCOUNT.id);
      const credential = accounts.find(
        (entry) => entry.providerId === "credential"
      );
      if (credential === undefined) {
        await ctx.internalAdapter.linkAccount({
          userId: DEMO_SEED_ACCOUNT.id,
          providerId: "credential",
          accountId: DEMO_SEED_ACCOUNT.id,
          password: hashed
        });
      } else {
        // Keep the hash aligned with the current BETTER_AUTH_SECRET derivation.
        await ctx.internalAdapter.updatePassword(DEMO_SEED_ACCOUNT.id, hashed);
      }
    },
    async signInDemo(request: Request): Promise<Response> {
      const password = deriveDemoSeedPassword(config.secret);
      const signInResponse = await auth.api.signInEmail({
        body: {
          email: DEMO_SEED_ACCOUNT.email,
          password,
          rememberMe: true
        },
        headers: request.headers,
        asResponse: true
      });

      if (!signInResponse.ok) {
        return Response.json(
          { error: "Demo sign-in failed.", code: "DEMO_SIGN_IN_FAILED" },
          { status: 500 }
        );
      }

      const headers = new Headers();
      copySetCookieHeaders(signInResponse.headers, headers);
      return Response.json({ ok: true }, { headers });
    }
  });
}
