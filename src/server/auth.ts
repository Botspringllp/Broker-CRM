import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db";
import { sendPasswordReset } from "./email";

const DEV_FALLBACK_SECRET = "dev-broker-crm-secret-key-32-chars-min!!";

// In production runtime, enforce that BETTER_AUTH_SECRET and BETTER_AUTH_URL are set,
// and that the secret is not using the development fallback.
// During local `npm run build` (where NEXT_PHASE === "phase-production-build"),
// static page generation is allowed to succeed with the existing local .env.
if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
  if (!process.env.BETTER_AUTH_SECRET) {
    throw new Error(
      "[Broker CRM] BETTER_AUTH_SECRET must be set in production. Please configure it in your environment variables."
    );
  }
  if (process.env.BETTER_AUTH_SECRET === DEV_FALLBACK_SECRET) {
    throw new Error(
      "[Broker CRM] BETTER_AUTH_SECRET must not equal the development fallback secret in production."
    );
  }
  if (!process.env.BETTER_AUTH_URL) {
    throw new Error(
      "[Broker CRM] BETTER_AUTH_URL must be set in production. Please configure it in your environment variables."
    );
  }
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET || DEV_FALLBACK_SECRET,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    sendResetPassword: async ({ user, token }) => {
      await sendPasswordReset({
        email: user.email,
        name: user.name || "User",
        token,
        expiresInMinutes: 60,
      });
    },
  },
  user: {
    additionalFields: {
      tenantId: {
        type: "string",
        required: true,
        input: false,
      },
      phone: {
        type: "string",
        required: true,
      },
      role: {
        type: "string",
        required: true,
        input: false,
      },
      isActive: {
        type: "boolean",
        required: false,
        defaultValue: true,
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days rolling session (DEC-M1-07 default)
    updateAge: 60 * 60 * 24, // 1 day
    additionalFields: {
      tenantId: {
        type: "string",
        required: false,
      },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          // Stamp tenantId on the session if user has a tenant
          try {
            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              select: { tenantId: true },
            });
            if (user?.tenantId) {
              return {
                data: {
                  ...session,
                  tenantId: user.tenantId,
                },
              };
            }
          } catch {
            // Ignore during offline testing or when database is not connected
          }
          return { data: session };
        },
      },
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;

