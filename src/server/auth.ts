import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET || "dev-broker-crm-secret-key-32-chars-min!!",
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      tenantId: {
        type: "string",
        required: true,
      },
      phone: {
        type: "string",
        required: true,
      },
      role: {
        type: "string",
        required: true,
      },
      isActive: {
        type: "boolean",
        required: false,
        defaultValue: true,
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

