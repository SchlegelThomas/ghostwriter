import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  ghostwriterSchema,
  type RepositoryDatabase
} from "@ghostwriter/storage";
import { betterAuth } from "better-auth";
import {
  pagesPreviewCookieDomain,
  type BackendConfig
} from "./config.js";

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
    }
  });
}
