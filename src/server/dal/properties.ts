import { prisma } from "../db";
import { TenantContext, NotFoundError } from "../tenant-context";
import { assertPermission } from "../permissions";
import { Prisma } from "@prisma/client";

/**
 * Lists properties strictly scoped to the authenticated tenant.
 * Telecallers are restricted to assigned supply if viewing unvalidated inventory.
 */
export async function listProperties(
  context: TenantContext,
  filters?: {
    validationStatus?: Prisma.EnumSupplyValidationStatusFilter;
    availabilityStatus?: Prisma.EnumPropertyAvailabilityStatusFilter;
    preference?: Prisma.EnumTransactionTypeFilter;
    isActiveSupply?: boolean;
    searchTerm?: string;
  }
) {
  assertPermission(context, "supply:view_assigned");

  const where: Prisma.PropertyWhereInput = {
    tenantId: context.tenantId, // STRICT TENANT ENFORCEMENT
  };

  if (filters?.validationStatus) where.validationStatus = filters.validationStatus;
  if (filters?.availabilityStatus) where.availabilityStatus = filters.availabilityStatus;
  if (filters?.preference) where.preference = filters.preference;
  if (typeof filters?.isActiveSupply === "boolean") where.isActiveSupply = filters.isActiveSupply;

  if (filters?.searchTerm) {
    where.OR = [
      { societyName: { contains: filters.searchTerm, mode: "insensitive" } },
      { localityName: { contains: filters.searchTerm, mode: "insensitive" } },
      { city: { contains: filters.searchTerm, mode: "insensitive" } },
      { ownerName: { contains: filters.searchTerm, mode: "insensitive" } },
    ];
  }

  return prisma.property.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      keyHolders: true,
      media: true,
    },
  });
}

/**
 * Retrieves a property by ID strictly scoped to the authenticated tenant.
 * Throws NotFoundError if not found or belongs to another tenant.
 */
export async function getPropertyById(context: TenantContext, propertyId: string) {
  assertPermission(context, "supply:view_assigned");

  const property = await prisma.property.findFirst({
    where: {
      id: propertyId,
      tenantId: context.tenantId, // STRICT TENANT SCOPE
    },
    include: {
      keyHolders: true,
      media: true,
      callLogs: {
        orderBy: { calledAt: "desc" },
      },
    },
  });

  if (!property) {
    throw new NotFoundError("Property not found.");
  }

  return property;
}

/**
 * Updates a property atomically enforcing tenant scope using compound unique key.
 */
export async function updateProperty(
  context: TenantContext,
  propertyId: string,
  data: Prisma.PropertyUpdateInput
) {
  assertPermission(context, "supply:log_call");

  // Verify existence in tenant before mutating
  await getPropertyById(context, propertyId);

  return prisma.property.update({
    where: {
      id_tenantId: {
        id: propertyId,
        tenantId: context.tenantId, // ATOMIC TENANT SCOPED MUTATION
      },
    },
    data,
  });
}

