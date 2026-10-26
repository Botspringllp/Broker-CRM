import { prisma } from "../db";
import { TenantContext, NotFoundError } from "../tenant-context";
import { assertPermission } from "../permissions";
import { Prisma, UserRole } from "@prisma/client";

/**
 * Lists properties strictly scoped to the authenticated tenant.
 * - Field Verifiers view only submitted or assigned verification inventory.
 * - Telecallers view assigned unvalidated inventory and tenant active supply pool.
 * - Field Sales Agents and Tenant Admins have zero operational supply access.
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

  // Field Verifier scoping: only submitted properties or actively assigned verification tasks
  if (context.role === UserRole.FIELD_VERIFIER) {
    where.OR = [
      { submittingAgentId: context.userId },
      { assignments: { some: { assignedUserId: context.userId, status: "ACTIVE" } } },
    ];
  }

  // Telecaller scoping: if not viewing the active pool, restrict to assigned supply
  if (context.role === UserRole.TELECALLER && filters?.isActiveSupply !== true) {
    where.OR = [
      { submittingAgentId: context.userId },
      { assignments: { some: { assignedUserId: context.userId, status: "ACTIVE" } } },
      { isActiveSupply: true }, // can always view active pool
    ];
  }

  if (filters?.validationStatus) where.validationStatus = filters.validationStatus;
  if (filters?.availabilityStatus) where.availabilityStatus = filters.availabilityStatus;
  if (filters?.preference) where.preference = filters.preference;
  if (typeof filters?.isActiveSupply === "boolean") where.isActiveSupply = filters.isActiveSupply;

  if (filters?.searchTerm) {
    const searchFilter = [
      { societyName: { contains: filters.searchTerm, mode: "insensitive" as const } },
      { localityName: { contains: filters.searchTerm, mode: "insensitive" as const } },
      { city: { contains: filters.searchTerm, mode: "insensitive" as const } },
      { ownerName: { contains: filters.searchTerm, mode: "insensitive" as const } },
    ];
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: searchFilter }];
      delete where.OR;
    } else {
      where.OR = searchFilter;
    }
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
 * Retrieves a property by ID strictly scoped to the authenticated tenant and role assignment.
 * Throws NotFoundError if not found, belongs to another tenant, or outside user's assigned scope.
 */
export async function getPropertyById(context: TenantContext, propertyId: string) {
  assertPermission(context, "supply:view_assigned");

  const where: Prisma.PropertyWhereInput = {
    id: propertyId,
    tenantId: context.tenantId, // STRICT TENANT SCOPE
  };

  // Field Verifier can only view assigned or submitted properties
  if (context.role === UserRole.FIELD_VERIFIER) {
    where.OR = [
      { submittingAgentId: context.userId },
      { assignments: { some: { assignedUserId: context.userId, status: "ACTIVE" } } },
    ];
  }

  const property = await prisma.property.findFirst({
    where,
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
 * Creates a property record using the approved property creation workflow.
 * Available to Broker Owner, Team Leader, Telecaller, and Field Verifier.
 */
export async function createProperty(
  context: TenantContext,
  data: {
    societyName: string;
    flatNumber: string;
    localityName: string;
    city: string;
    preference: "SALE" | "RENT";
    propertyType: "APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT";
    furnishingStatus: "UNFURNISHED" | "SEMI_FURNISHED" | "FURNISHED";
    constructionStatus: "READY_TO_MOVE" | "UNDER_CONSTRUCTION";
    bedroomCount: number;
    bathroomCount: number;
    balconyCount?: number;
    area: number;
    areaType: "CARPET" | "BUILT_UP" | "SUPER_BUILT_UP";
    price: number;
    ownerName: string;
    ownerMobile: string;
    amenities?: string[];
  }
) {
  assertPermission(context, "supply:create");

  return prisma.property.create({
    data: {
      tenantId: context.tenantId,
      submittingAgentId: context.userId,
      societyName: data.societyName,
      flatNumber: data.flatNumber,
      localityName: data.localityName,
      city: data.city,
      preference: data.preference,
      propertyType: data.propertyType,
      furnishingStatus: data.furnishingStatus,
      constructionStatus: data.constructionStatus,
      bedroomCount: data.bedroomCount,
      bathroomCount: data.bathroomCount,
      balconyCount: data.balconyCount ?? 0,
      area: new Prisma.Decimal(data.area),
      areaType: data.areaType,
      price: new Prisma.Decimal(data.price),
      ownerName: data.ownerName,
      ownerMobile: data.ownerMobile,
      amenities: data.amenities ?? [],
      validationStatus: "NOT_VALIDATED",
      availabilityStatus: "AVAILABLE",
      isActiveSupply: false,
    },
    include: {
      keyHolders: true,
      media: true,
    },
  });
}

/**
 * Updates a property atomically enforcing tenant scope and permission separation.
 * CRITICAL RULE: Property creation/submission does NOT permit approving/finalizing verification.
 * Approving verification to VALIDATED requires 'supply:validate' (denied to Field Verifiers).
 */
export async function updateProperty(
  context: TenantContext,
  propertyId: string,
  data: Prisma.PropertyUpdateInput
) {
  // If attempting to approve validation, enforce strict supply:validate permission
  if (
    data.validationStatus === "VALIDATED" ||
    (typeof data.validationStatus === "object" &&
      (data.validationStatus as { set?: string }).set === "VALIDATED")
  ) {
    assertPermission(context, "supply:validate");
  } else {
    assertPermission(context, "supply:log_call");
  }

  // Verify existence in tenant and role scope before mutating
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
