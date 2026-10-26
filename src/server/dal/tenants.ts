import { prisma } from "../db";
import { TenantContext } from "../tenant-context";
import { assertPermission } from "../permissions";
import { ForbiddenError, NotFoundError } from "../errors";
import { UserRole } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

export interface ProvisionTenantData {
  name: string;
  slug: string;
  contactEmail?: string;
  contactPhone?: string;
  maxSeats?: number;
  adminName: string;
  adminEmail: string;
  adminPhone?: string;
  adminPassword?: string;
}

/**
 * Lists all brokerage tenants on the platform.
 * Strictly restricted to Platform Super Admin.
 */
export async function listTenants(context: TenantContext) {
  assertPermission(context, "platform:manage_tenants");

  const tenants = await prisma.tenant.findMany({
    where: {
      slug: { not: "platform-system" }, // Exclude internal platform admin tenant from customer list
    },
    include: {
      _count: {
        select: {
          users: true,
          properties: true,
          leads: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return tenants;
}

/**
 * Retrieves a single tenant by ID with administrative details.
 */
export async function getTenantById(context: TenantContext, tenantId: string) {
  assertPermission(context, "platform:manage_tenants");

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      users: {
        where: { role: UserRole.CRM_TENANT_ADMIN },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          isActive: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          users: true,
          properties: true,
          leads: true,
        },
      },
    },
  });

  if (!tenant) {
    throw new NotFoundError("Tenant not found.");
  }

  return tenant;
}

/**
 * Provisions a new brokerage tenant and initializes its primary CRM Tenant Admin.
 * Executes atomically within a database transaction.
 */
export async function provisionTenant(context: TenantContext, data: ProvisionTenantData) {
  assertPermission(context, "platform:manage_tenants");

  // Validate tenant attributes
  const cleanName = data.name?.trim();
  if (!cleanName || cleanName.length < 2) {
    throw new ForbiddenError("Tenant organization name must be at least 2 characters.");
  }

  const cleanSlug = data.slug?.toLowerCase().trim();
  if (!cleanSlug || !/^[a-z0-9-]+$/.test(cleanSlug)) {
    throw new ForbiddenError(
      "Tenant identifier (slug) must contain only lowercase letters, numbers, and hyphens."
    );
  }

  // Validate unique slug
  const existingSlug = await prisma.tenant.findUnique({
    where: { slug: cleanSlug },
  });
  if (existingSlug) {
    throw new ForbiddenError(`Tenant identifier '${cleanSlug}' is already in use.`);
  }

  // Validate admin user attributes
  const cleanAdminEmail = data.adminEmail?.toLowerCase().trim();
  if (!cleanAdminEmail || !cleanAdminEmail.includes("@")) {
    throw new ForbiddenError("A valid CRM Tenant Admin email address is required.");
  }

  const existingEmail = await prisma.user.findFirst({
    where: { email: cleanAdminEmail },
  });
  if (existingEmail) {
    throw new ForbiddenError(`User with email '${cleanAdminEmail}' already exists in the system.`);
  }

  const cleanAdminName = data.adminName?.trim() || "CRM Tenant Admin";
  const cleanAdminPhone = data.adminPhone?.trim() || "";
  const password = data.adminPassword || "TempPass1234!";

  if (password.length < 8) {
    throw new ForbiddenError("Initial password must be at least 8 characters long.");
  }

  const maxSeats = Number.isInteger(data.maxSeats) && (data.maxSeats ?? 0) > 0 ? data.maxSeats! : 10;
  const hashedPassword = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    // 1. Create Tenant
    const tenant = await tx.tenant.create({
      data: {
        name: cleanName,
        slug: cleanSlug,
        contactEmail: data.contactEmail?.trim() || cleanAdminEmail,
        contactPhone: data.contactPhone?.trim() || cleanAdminPhone,
        maxSeats,
        isActive: true,
      },
    });

    // 2. Create initial CRM Tenant Admin User
    const adminUser = await tx.user.create({
      data: {
        tenantId: tenant.id,
        name: cleanAdminName,
        email: cleanAdminEmail,
        phone: cleanAdminPhone,
        role: UserRole.CRM_TENANT_ADMIN,
        isActive: true,
        emailVerified: true,
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    // 3. Create Better Auth credential Account
    await tx.account.create({
      data: {
        userId: adminUser.id,
        providerId: "credential",
        accountId: adminUser.id,
        password: hashedPassword,
      },
    });

    // 4. Record audit log
    await tx.userAuditLog.create({
      data: {
        tenantId: tenant.id,
        targetUserId: adminUser.id,
        actorUserId: context.userId,
        action: "TENANT_PROVISIONED",
        details: {
          tenantId: tenant.id,
          tenantName: tenant.name,
          slug: tenant.slug,
          maxSeats: tenant.maxSeats,
          adminEmail: adminUser.email,
        },
      },
    });

    return {
      tenant,
      adminUser,
    };
  });
}

/**
 * Activates or deactivates a brokerage tenant organization.
 * Strictly enforced on the server to prevent inactive tenant operations.
 */
export async function updateTenantStatus(
  context: TenantContext,
  tenantId: string,
  isActive: boolean
) {
  assertPermission(context, "platform:manage_tenants");

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    throw new NotFoundError("Tenant not found.");
  }

  // Prevent deactivating system platform tenant
  if (tenant.slug === "platform-system") {
    throw new ForbiddenError("Cannot deactivate the system platform root tenant.");
  }

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: { isActive },
  });

  // Record audit log
  await prisma.userAuditLog.create({
    data: {
      tenantId: updated.id,
      actorUserId: context.userId,
      action: "TENANT_STATUS_UPDATED",
      details: {
        tenantId: updated.id,
        slug: updated.slug,
        previousStatus: tenant.isActive,
        newStatus: isActive,
      },
    },
  });

  return updated;
}

