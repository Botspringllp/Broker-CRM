import crypto from "crypto";
import {
  PrismaClient,
  Tenant,
  User,
  UserRole,
  TransactionType,
  PropertyType,
  FurnishingStatus,
  AreaUnitType,
  ConstructionStatus,
  SupplyValidationStatus,
  PropertyAvailabilityStatus,
} from "@prisma/client";
import { TenantContext } from "@/server/tenant-context";

export interface TestTenantFixture {
  tenant: Tenant;
  cleanup: () => Promise<void>;
}

export interface TestUserOptions {
  name?: string;
  email?: string;
  role?: UserRole;
  phone?: string;
}

export interface TestPropertyOptions {
  flatNumber?: string;
  societyName?: string;
  localityName?: string;
  city?: string;
  preference?: TransactionType;
  propertyType?: PropertyType;
  furnishingStatus?: FurnishingStatus;
  areaType?: AreaUnitType;
  constructionStatus?: ConstructionStatus;
  bedroomCount?: number;
  bathroomCount?: number;
  price?: number;
  area?: number;
  ownerName?: string;
  ownerMobile?: string;
  isActiveSupply?: boolean;
  validationStatus?: SupplyValidationStatus;
  availabilityStatus?: PropertyAvailabilityStatus;
}

export interface TestLeadOptions {
  name?: string;
  primaryPhone?: string;
  originalSource?: string;
  assignedTelecallerId?: string;
}

/**
 * Creates an isolated test tenant with a dynamic, unique slug.
 * Returns the tenant record and a scoped cleanup helper that cleanly deletes all child records
 * in reverse foreign-key dependency order to prevent PostgreSQL Restrict/FK violation errors.
 */
export async function createTestTenant(
  prisma: PrismaClient,
  namePrefix = "Integration Test Tenant"
): Promise<TestTenantFixture> {
  const uniqueSuffix = crypto.randomUUID().slice(0, 8);
  const slug = `test-${uniqueSuffix}-${Date.now().toString(36)}`;

  const tenant = await prisma.tenant.create({
    data: {
      name: `${namePrefix} ${uniqueSuffix}`,
      slug,
      isActive: true,
      maxSeats: 10,
    },
  });

  const cleanup = async () => {
    try {
      // 1. Delete operational site visit records
      await prisma.siteVisitItem.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.siteVisitAccessLink.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.siteVisitScheduleHistory.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.siteVisit.deleteMany({ where: { tenantId: tenant.id } });

      // 2. Delete feedback and operational activities
      await prisma.buyerPropertyInterest.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.callLog.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.assignment.deleteMany({ where: { tenantId: tenant.id } });

      // 3. Delete supply records
      await prisma.propertyVerification.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.propertyMedia.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.keyHolder.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.property.deleteMany({ where: { tenantId: tenant.id } });

      // 4. Delete demand records
      await prisma.enquiry.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.leadRequirementLocality.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.leadRequirement.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.leadChangeLog.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.lead.deleteMany({ where: { tenantId: tenant.id } });

      // 5. Delete user records (audit logs, sessions, accounts, users)
      await prisma.userAuditLog.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.session.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.user.deleteMany({ where: { tenantId: tenant.id } });

      // 6. Delete master data & tenant
      await prisma.locality.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
    } catch (err: unknown) {
      console.warn(`[Tenant Cleanup Warning] Non-fatal error cleaning up tenant ${tenant.id}:`, err);
    }
  };

  return { tenant, cleanup };
}

/**
 * Creates a test user within a specified tenant.
 */
export async function createTestUser(
  prisma: PrismaClient,
  tenantId: string,
  options: TestUserOptions = {}
) {
  const uniqueId = crypto.randomUUID().slice(0, 6);
  const role = options.role || UserRole.TELECALLER;
  const email = options.email || `test.${role.toLowerCase()}.${uniqueId}@test.local`;
  const name = options.name || `Test User ${uniqueId}`;
  const phone = options.phone || `98${Math.floor(10000000 + Math.random() * 90000000)}`;

  return prisma.user.create({
    data: {
      tenantId,
      name,
      email,
      role,
      phone,
      isActive: true,
    },
  });
}

/**
 * Creates a test property within a specified tenant.
 */
export async function createTestProperty(
  prisma: PrismaClient,
  tenantId: string,
  options: TestPropertyOptions = {}
) {
  const uniqueId = crypto.randomUUID().slice(0, 6);
  return prisma.property.create({
    data: {
      tenantId,
      flatNumber: options.flatNumber || `Flat-${Math.floor(100 + Math.random() * 900)}`,
      societyName: options.societyName || `Test Society ${uniqueId}`,
      localityName: options.localityName || `Sector ${Math.floor(1 + Math.random() * 80)}`,
      city: options.city || "Gurugram",
      preference: options.preference || TransactionType.SALE,
      furnishingStatus: options.furnishingStatus || FurnishingStatus.SEMI_FURNISHED,
      propertyType: options.propertyType || PropertyType.APARTMENT,
      area: options.area ?? 1200,
      areaType: options.areaType || AreaUnitType.SUPER_BUILT_UP,
      bedroomCount: options.bedroomCount ?? 2,
      bathroomCount: options.bathroomCount ?? 2,
      price: options.price ?? 15000000,
      constructionStatus: options.constructionStatus || ConstructionStatus.READY_TO_MOVE,
      ownerName: options.ownerName || `Test Owner ${uniqueId}`,
      ownerMobile: options.ownerMobile || `98${Math.floor(10000000 + Math.random() * 90000000)}`,
      isActiveSupply: options.isActiveSupply ?? false,
      validationStatus: options.validationStatus || SupplyValidationStatus.NOT_VALIDATED,
      availabilityStatus: options.availabilityStatus || PropertyAvailabilityStatus.AVAILABLE,
    },
  });
}

/**
 * Creates a test lead within a specified tenant.
 */
export async function createTestLead(
  prisma: PrismaClient,
  tenantId: string,
  options: TestLeadOptions = {}
) {
  const uniqueId = crypto.randomUUID().slice(0, 6);
  return prisma.lead.create({
    data: {
      tenantId,
      name: options.name || `Test Buyer ${uniqueId}`,
      primaryPhone: options.primaryPhone || `98${Math.floor(10000000 + Math.random() * 90000000)}`,
      originalSource: options.originalSource || "MANUAL",
      assignedTelecallerId: options.assignedTelecallerId,
    },
  });
}

/**
 * Creates a TenantContext mock for DAL operations scoped to a real test User.
 */
export function createTestContext(
  user: User | { id: string; email: string; name: string; role: UserRole; tenantId: string; isActive?: boolean }
): TenantContext {
  return {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      isActive: "isActive" in user ? user.isActive ?? true : true,
    },
    session: {
      id: `test-session-${user.id}`,
      token: `test-token-${user.id}`,
      expiresAt: new Date(Date.now() + 86400000),
    },
  };
}
