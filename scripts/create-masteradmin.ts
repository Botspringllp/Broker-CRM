import { PrismaClient, UserRole } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

const prisma = new PrismaClient();

async function main() {
  const email = "masteradmin@crm.in";
  const password = process.env.MASTER_ADMIN_PASSWORD;

  if (!password) {
    throw new Error("MASTER_ADMIN_PASSWORD is missing.");
  }

  // Existing platform admin se platform tenant identify karo
  const existingAdmin = await prisma.user.findUnique({
    where: { email: "superadmin@crm.in" },
    select: { tenantId: true },
  });

  if (!existingAdmin) {
    throw new Error("Existing platform admin or tenant not found.");
  }

  const tenantId = existingAdmin.tenantId;

  // Existing account check
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    console.log("User already exists:", email);
    return;
  }

  const hashedPassword = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: "Master Admin",
        email,
        emailVerified: true,
        phone: "0000000000",
        tenantId,
        role: UserRole.PLATFORM_SUPER_ADMIN,
        isActive: true,
      },
    });

    await tx.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hashedPassword,
      },
    });
  });

  console.log("MASTER ADMIN CREATED SUCCESSFULLY");
  console.log("Email:", email);
  console.log("Role: PLATFORM_SUPER_ADMIN");
}

main()
  .catch((error) => {
    console.error("ERROR:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });