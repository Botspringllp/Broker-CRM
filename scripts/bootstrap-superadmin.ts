/**
 * Secure One-Time Platform Super Admin Bootstrap Script
 *
 * Grounded in Broker CRM Architecture & Security Guidelines:
 * - Creates the initial Platform Super Admin with scrypt password hashing compatible with Better Auth.
 * - Requires explicit credentials via environment variables or interactive prompt.
 * - Strictly idempotent: Refuses to run if a Platform Super Admin already exists.
 * - Never runs automatically on application startup.
 * - Never stores or logs plaintext passwords.
 */

import { UserRole } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { prisma } from "../src/server/db";

async function promptCredentials() {
  const envEmail = process.env.SUPERADMIN_EMAIL?.trim();
  const envPassword = process.env.SUPERADMIN_PASSWORD;
  const envName = process.env.SUPERADMIN_NAME?.trim();
  const envPhone = process.env.SUPERADMIN_PHONE?.trim();

  if (envEmail && envPassword) {
    return {
      email: envEmail,
      password: envPassword,
      name: envName || "Platform Super Administrator",
      phone: envPhone || "+91 99999 00000",
    };
  }

  // Fallback to interactive terminal prompt if stdin is a TTY
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input, output });
    try {
      console.log("\n========================================================");
      console.log("   Broker CRM - Platform Super Admin Bootstrap Setup   ");
      console.log("========================================================\n");

      const email = (await rl.question("Enter Super Admin Email: ")).trim();
      const name = (await rl.question("Enter Full Name [Platform Super Administrator]: ")).trim() || "Platform Super Administrator";
      const phone = (await rl.question("Enter Contact Phone [+91 99999 00000]: ")).trim() || "+91 99999 00000";
      const password = await rl.question("Enter Super Admin Password (min 8 chars): ");

      return { email, password, name, phone };
    } finally {
      rl.close();
    }
  }

  throw new Error(
    "Missing credentials. Please set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD environment variables, or run interactively in a terminal."
  );
}

export async function bootstrapSuperAdmin(options?: {
  email?: string;
  password?: string;
  name?: string;
  phone?: string;
}) {
  console.log("[Bootstrap] Checking for existing Platform Super Admin account...");

  const existingAdmin = await prisma.user.findFirst({
    where: { role: UserRole.PLATFORM_SUPER_ADMIN },
    select: { id: true, email: true },
  });

  if (existingAdmin) {
    console.log(`[Bootstrap] Notice: A Platform Super Admin already exists (${existingAdmin.email}).`);
    console.log("[Bootstrap] Bootstrap cancelled to prevent unauthorized duplicate administrative accounts.");
    return { success: false, reason: "ALREADY_EXISTS", userId: existingAdmin.id };
  }

  const credentials = options?.email && options?.password
    ? {
        email: options.email.trim(),
        password: options.password,
        name: options.name || "Platform Super Administrator",
        phone: options.phone || "+91 99999 00000",
      }
    : await promptCredentials();

  // Basic validation
  if (!credentials.email || !credentials.email.includes("@")) {
    throw new Error("Invalid email address provided.");
  }

  if (!credentials.password || credentials.password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }

  console.log(`[Bootstrap] Initializing Platform Super Admin: ${credentials.email}`);

  // Hash password with Better Auth's native scrypt implementation
  const hashedPassword = await hashPassword(credentials.password);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Ensure system platform root tenant exists
    let platformTenant = await tx.tenant.findUnique({
      where: { slug: "platform-system" },
    });

    if (!platformTenant) {
      platformTenant = await tx.tenant.create({
        data: {
          name: "Broker CRM Platform Administration",
          slug: "platform-system",
          contactEmail: credentials.email,
          contactPhone: credentials.phone,
          maxSeats: 999999,
          isActive: true,
        },
      });
      console.log(`[Bootstrap] Created Platform Root Tenant (ID: ${platformTenant.id})`);
    }

    // 2. Create the User record
    const user = await tx.user.create({
      data: {
        tenantId: platformTenant.id,
        name: credentials.name,
        email: credentials.email.toLowerCase(),
        emailVerified: true,
        phone: credentials.phone,
        role: UserRole.PLATFORM_SUPER_ADMIN,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
      },
    });

    // 3. Create Better Auth credential Account record
    await tx.account.create({
      data: {
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: hashedPassword,
      },
    });

    // 4. Record immutable UserAuditLog
    await tx.userAuditLog.create({
      data: {
        tenantId: platformTenant.id,
        targetUserId: user.id,
        actorUserId: user.id,
        action: "PLATFORM_SUPER_ADMIN_BOOTSTRAP",
        details: {
          email: user.email,
          role: user.role,
          initializedAt: new Date().toISOString(),
        },
      },
    });

    return { user, tenant: platformTenant };
  });

  console.log("\n========================================================");
  console.log("✔ Platform Super Admin successfully bootstrapped!");
  console.log(`  User ID:   ${result.user.id}`);
  console.log(`  Email:     ${result.user.email}`);
  console.log(`  Role:      ${result.user.role}`);
  console.log(`  Tenant ID: ${result.tenant.id}`);
  console.log("========================================================\n");

  return { success: true, user: result.user, tenant: result.tenant };
}

// Execute directly if run via CLI
if (require.main === module || process.argv[1]?.endsWith("bootstrap-superadmin.ts")) {
  bootstrapSuperAdmin()
    .catch((err) => {
      console.error("\n[Bootstrap ERROR]:", err.message || err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
