import { prisma } from "../db";
import {
  TenantContext,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  DuplicatePropertyError,
} from "../tenant-context";
import { assertPermission } from "../permissions";
import {
  Prisma,
  UserRole,
  KeyHolderPersona,
  PropertyType,
  TransactionType,
  FurnishingStatus,
  ConstructionStatus,
  AreaUnitType,
  PropertyCallingDisposition,
  CallTargetType,
  SupplyValidationStatus,
  PropertyAvailabilityStatus,
  AssignmentStatus,
  AssignmentTargetType,
} from "@prisma/client";

export * from "./assignments";

/**
 * Checks whether a property qualifies for the Active Supply Pool.
 * PRD Rule: Requires BOTH confirmed owner willingness AND complete validation of availability/details.
 */
export function isEligibleForActiveSupply(params: {
  ownerWillingnessConfirmed: boolean;
  validationStatus: string;
  availabilityStatus: string;
}): boolean {
  return (
    params.ownerWillingnessConfirmed === true &&
    params.validationStatus === "VALIDATED" &&
    params.availabilityStatus === "AVAILABLE"
  );
}

/**
 * Checks for a potential duplicate property within the current tenant only.
 * Normalizes society name and flat number (trimmed, case-insensitive).
 * Never mutates or overwrites existing records.
 */
export async function checkDuplicateProperty(
  context: TenantContext,
  params: {
    societyName: string;
    flatNumber: string;
  }
) {
  const trimmedSociety = params.societyName?.trim();
  const trimmedFlat = params.flatNumber?.trim();

  if (!trimmedSociety || !trimmedFlat) {
    return { isDuplicate: false, duplicate: null };
  }

  const existing = await prisma.property.findFirst({
    where: {
      tenantId: context.tenantId, // STRICT TENANT ISOLATION
      societyName: { equals: trimmedSociety, mode: "insensitive" },
      flatNumber: { equals: trimmedFlat, mode: "insensitive" },
    },
    select: {
      id: true,
      societyName: true,
      flatNumber: true,
      bedroomCount: true,
      propertyType: true,
      validationStatus: true,
      availabilityStatus: true,
      ownerName: true,
      createdAt: true,
    },
  });

  if (existing) {
    return { isDuplicate: true, duplicate: existing };
  }

  return { isDuplicate: false, duplicate: null };
}

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
      {
        assignments: {
          some: {
            assignedUserId: context.userId,
            status: AssignmentStatus.ACTIVE,
            targetType: AssignmentTargetType.PROPERTY,
          },
        },
      },
    ];
  }

  // Telecaller scoping:
  // - If viewing Active Supply Pool (filters.isActiveSupply === true), allow browsing active pool.
  // - If viewing validation queue (filters.isActiveSupply !== true), strictly restrict to properties
  //   where the telecaller has an ACTIVE assignment for property validation.
  //   Submitting agent relationship does NOT bypass validation assignment.
  //   Active supply properties must NEVER leak into the validation calling queue.
  if (context.role === UserRole.TELECALLER) {
    if (filters?.isActiveSupply === true) {
      where.isActiveSupply = true;
    } else {
      where.assignments = {
        some: {
          assignedUserId: context.userId,
          status: AssignmentStatus.ACTIVE,
          targetType: AssignmentTargetType.PROPERTY,
        },
      };
    }
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
      callLogs: {
        orderBy: { calledAt: "desc" },
        include: { caller: true },
      },
      assignments: {
        orderBy: { assignedAt: "desc" },
        include: {
          assignedUser: true,
          assignedByUser: true,
        },
      },
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
      {
        assignments: {
          some: {
            assignedUserId: context.userId,
            status: AssignmentStatus.ACTIVE,
            targetType: AssignmentTargetType.PROPERTY,
          },
        },
      },
    ];
  }

  const property = await prisma.property.findFirst({
    where,
    include: {
      keyHolders: true,
      media: true,
      callLogs: {
        orderBy: { calledAt: "desc" },
        include: { caller: true },
      },
      assignments: {
        orderBy: { assignedAt: "desc" },
        include: {
          assignedUser: true,
          assignedByUser: true,
        },
      },
    },
  });

  if (!property) {
    throw new NotFoundError("Property not found.");
  }

  // Telecaller can only view actively assigned properties or active supply pool
  if (context.role === UserRole.TELECALLER && property.assignments) {
    const isAssigned = property.assignments.some(
      (a) =>
        a.assignedUserId === context.userId &&
        a.status === AssignmentStatus.ACTIVE &&
        (!a.targetType || a.targetType === AssignmentTargetType.PROPERTY)
    );
    if (!isAssigned && !property.isActiveSupply) {
      throw new NotFoundError("Property not found.");
    }
  }

  return property;
}

export interface KeyHolderInput {
  name?: string | null;
  mobile?: string | null;
  persona?: KeyHolderPersona | string | null;
  notes?: string | null;
}

export interface CreatePropertyInput {
  societyName: string;
  flatNumber: string;
  localityName: string;
  city: string;
  preference: TransactionType | "SALE" | "RENT";
  propertyType: PropertyType | "APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT" | "COMMERCIAL" | "OTHER";
  furnishingStatus: FurnishingStatus | "UNFURNISHED" | "SEMI_FURNISHED" | "FURNISHED";
  constructionStatus: ConstructionStatus | "READY_TO_MOVE" | "UNDER_CONSTRUCTION";
  bedroomCount: number;
  bathroomCount: number;
  balconyCount?: number;
  area: number;
  areaType: AreaUnitType | "CARPET" | "BUILT_UP" | "SUPER_BUILT_UP";
  price: number;
  ownerName: string;
  ownerMobile: string;
  amenities?: string[];
  keyHolder?: KeyHolderInput | null;
  confirmDuplicate?: boolean;
}

function normalizeMobile(mobile: string): string {
  // Strip non-digit characters
  const digits = mobile.replace(/\D/g, "");
  // If 12 digits starting with 91, extract last 10
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  // If 11 digits starting with 0, extract last 10
  if (digits.length === 11 && digits.startsWith("0")) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Creates a property record using the approved property creation workflow.
 * Available to Broker Owner, Team Leader, Telecaller, and Field Verifier.
 * Strictly derives tenantId and submittingAgentId from server-side context.
 * Enforces duplicate warnings, input validation, and optional KeyHolder persistence.
 */
export async function createProperty(context: TenantContext, data: CreatePropertyInput) {
  assertPermission(context, "supply:create");

  // Field validation
  if (!data.societyName?.trim()) throw new ValidationError("Society name is required.");
  if (!data.flatNumber?.trim()) throw new ValidationError("Flat number is required.");
  if (!data.localityName?.trim()) throw new ValidationError("Locality is required.");
  if (!data.city?.trim()) throw new ValidationError("City is required.");
  if (!data.ownerName?.trim()) throw new ValidationError("Owner name is required.");
  if (!data.ownerMobile?.trim()) throw new ValidationError("Owner mobile number is required.");

  const normalizedOwnerMobile = normalizeMobile(data.ownerMobile);
  if (!/^[6-9]\d{9}$/.test(normalizedOwnerMobile)) {
    throw new ValidationError("Owner mobile must be a valid 10-digit Indian mobile number.");
  }

  if (typeof data.bedroomCount !== "number" || data.bedroomCount < 0) {
    throw new ValidationError("Bedroom count must be a non-negative number.");
  }
  if (typeof data.bathroomCount !== "number" || data.bathroomCount < 0) {
    throw new ValidationError("Bathroom count must be a non-negative number.");
  }
  if (typeof data.area !== "number" || data.area <= 0) {
    throw new ValidationError("Property area must be greater than zero.");
  }
  if (typeof data.price !== "number" || data.price <= 0) {
    throw new ValidationError("Property price must be greater than zero.");
  }

  // Duplicate check: check within tenant unless explicitly confirmed
  if (!data.confirmDuplicate) {
    const dupCheck = await checkDuplicateProperty(context, {
      societyName: data.societyName,
      flatNumber: data.flatNumber,
    });
    if (dupCheck.isDuplicate && dupCheck.duplicate) {
      throw new DuplicatePropertyError(
        `A property in '${dupCheck.duplicate.societyName}' with Flat '${dupCheck.duplicate.flatNumber}' already exists in your brokerage.`,
        dupCheck.duplicate
      );
    }
  }

  // KeyHolder data processing (optional)
  let keyHolderCreate: Prisma.KeyHolderCreateWithoutPropertyInput | undefined;
  if (data.keyHolder && data.keyHolder.name && data.keyHolder.name.trim().length > 0) {
    const khName = data.keyHolder.name.trim();
    const rawKhMobile = data.keyHolder.mobile?.trim() || "";
    let khMobile = "";
    if (rawKhMobile) {
      khMobile = normalizeMobile(rawKhMobile);
      if (!/^[6-9]\d{9}$/.test(khMobile)) {
        throw new ValidationError("Key-holder mobile must be a valid 10-digit Indian mobile number.");
      }
    }

    const personaVal = (data.keyHolder.persona as KeyHolderPersona) || KeyHolderPersona.OTHER;

    keyHolderCreate = {
      tenant: { connect: { id: context.tenantId } },
      name: khName,
      mobile: khMobile || normalizedOwnerMobile, // Default to owner mobile if not specified
      persona: personaVal,
      notes: data.keyHolder.notes?.trim() || null,
    };
  }

  return prisma.property.create({
    data: {
      tenantId: context.tenantId,
      submittingAgentId: context.userId,
      societyName: data.societyName.trim(),
      flatNumber: data.flatNumber.trim(),
      localityName: data.localityName.trim(),
      city: data.city.trim(),
      preference: data.preference as TransactionType,
      propertyType: data.propertyType as PropertyType,
      furnishingStatus: data.furnishingStatus as FurnishingStatus,
      constructionStatus: data.constructionStatus as ConstructionStatus,
      bedroomCount: Math.floor(data.bedroomCount),
      bathroomCount: Math.floor(data.bathroomCount),
      balconyCount: data.balconyCount ? Math.floor(data.balconyCount) : 0,
      area: new Prisma.Decimal(data.area),
      areaType: data.areaType as AreaUnitType,
      price: new Prisma.Decimal(data.price),
      ownerName: data.ownerName.trim(),
      ownerMobile: normalizedOwnerMobile,
      amenities: data.amenities ?? [],
      // Safe lifecycle defaults: newly created property is never in active supply
      ownerWillingnessConfirmed: false,
      validationStatus: "NOT_VALIDATED",
      availabilityStatus: "AVAILABLE",
      isActiveSupply: false,
      entryChannel: "MANUAL",
      keyHolders: keyHolderCreate ? { create: keyHolderCreate } : undefined,
    },
    include: {
      keyHolders: true,
      media: true,
      callLogs: {
        orderBy: { calledAt: "desc" },
        include: { caller: true },
      },
    },
  });
}

/**
 * Updates a property atomically enforcing tenant scope and permission separation.
 * CRITICAL RULE: Approving verification to VALIDATED requires 'supply:validate' (denied to Field Verifiers).
 * Active supply eligibility is enforced server-side: requires both ownerWillingnessConfirmed: true
 * AND validationStatus: VALIDATED AND availabilityStatus: AVAILABLE.
 */
export async function updateProperty(
  context: TenantContext,
  propertyId: string,
  data: Prisma.PropertyUpdateInput
) {
  // If attempting to approve validation, enforce strict supply:validate permission
  const isSettingValidated =
    data.validationStatus === "VALIDATED" ||
    (typeof data.validationStatus === "object" &&
      (data.validationStatus as { set?: string }).set === "VALIDATED");

  if (isSettingValidated) {
    assertPermission(context, "supply:validate");
  } else {
    assertPermission(context, "supply:log_call");
  }

  // Verify existence in tenant and role scope before mutating
  const existing = await getPropertyById(context, propertyId);

  const safeData: Prisma.PropertyUpdateInput = { ...data };

  // Only recompute isActiveSupply when lifecycle or willingness statuses are being updated
  if (
    data.validationStatus !== undefined ||
    data.availabilityStatus !== undefined ||
    data.ownerWillingnessConfirmed !== undefined ||
    data.isActiveSupply !== undefined
  ) {
    const effectiveWillingness =
      typeof data.ownerWillingnessConfirmed === "boolean"
        ? data.ownerWillingnessConfirmed
        : typeof data.ownerWillingnessConfirmed === "object" &&
          (data.ownerWillingnessConfirmed as { set?: boolean }).set !== undefined
        ? (data.ownerWillingnessConfirmed as { set?: boolean }).set!
        : existing.ownerWillingnessConfirmed;

    const effectiveValidationStatus =
      typeof data.validationStatus === "string"
        ? data.validationStatus
        : typeof data.validationStatus === "object" &&
          (data.validationStatus as { set?: string }).set !== undefined
        ? (data.validationStatus as { set?: string }).set!
        : existing.validationStatus;

    const effectiveAvailabilityStatus =
      typeof data.availabilityStatus === "string"
        ? data.availabilityStatus
        : typeof data.availabilityStatus === "object" &&
          (data.availabilityStatus as { set?: string }).set !== undefined
        ? (data.availabilityStatus as { set?: string }).set!
        : existing.availabilityStatus;

    safeData.isActiveSupply = isEligibleForActiveSupply({
      ownerWillingnessConfirmed: effectiveWillingness,
      validationStatus: effectiveValidationStatus,
      availabilityStatus: effectiveAvailabilityStatus,
    });
  }

  return prisma.property.update({
    where: {
      id_tenantId: {
        id: propertyId,
        tenantId: context.tenantId, // ATOMIC TENANT SCOPED MUTATION
      },
    },
    data: safeData,
  });
}

export interface LogPropertyCallInput {
  propertyId: string;
  disposition: PropertyCallingDisposition | string;
  notes?: string | null;
  callbackScheduledAt?: Date | string | null;
  confirmOwnerWillingness?: boolean;
}

/**
 * Logs a call outcome for a property validation target.
 * Enforces:
 * - 'supply:log_call' permission check.
 * - Strict tenant isolation.
 * - Telecaller assignment check: telecallers can only record calls against properties assigned to them or submitted by them.
 * - Non-destructive: creates a new CallLog record each time (never overwrites history).
 * - Exact 6 PRD dispositions supported.
 * - Required callback date/time on CALL_BACK.
 * - Server-side property status and active pool eligibility transitions.
 */
export async function logPropertyCall(context: TenantContext, input: LogPropertyCallInput) {
  assertPermission(context, "supply:log_call");

  if (!input.propertyId?.trim()) {
    throw new ValidationError("Property ID is required.");
  }

  // Strictly query within the authenticated tenant
  const property = await prisma.property.findFirst({
    where: {
      id: input.propertyId,
      tenantId: context.tenantId, // STRICT TENANT ISOLATION
    },
    include: {
      assignments: {
        where: {
          status: AssignmentStatus.ACTIVE,
          targetType: AssignmentTargetType.PROPERTY,
        },
      },
    },
  });

  if (!property) {
    throw new NotFoundError("Property not found.");
  }

  // Telecaller scoping: must have an active assignment to validate this property
  // Submitting agent relationship does NOT bypass validation assignment requirement
  if (context.role === UserRole.TELECALLER) {
    const isActivelyAssigned = property.assignments.some(
      (a) =>
        a.assignedUserId === context.userId &&
        a.status === AssignmentStatus.ACTIVE &&
        (!a.targetType || a.targetType === AssignmentTargetType.PROPERTY)
    );

    if (!isActivelyAssigned) {
      throw new ForbiddenError(
        "Access denied: You are not actively assigned to validate this property."
      );
    }
  }

  // Validate disposition enum
  const validDispositions = Object.values(PropertyCallingDisposition);
  const normalizedDisposition = input.disposition as PropertyCallingDisposition;

  if (!validDispositions.includes(normalizedDisposition)) {
    throw new ValidationError(
      `Invalid calling disposition: '${input.disposition}'. Supported dispositions are: ${validDispositions.join(", ")}.`
    );
  }

  // Validate callback scheduled at
  let callbackDate: Date | null = null;
  if (normalizedDisposition === PropertyCallingDisposition.CALL_BACK) {
    if (!input.callbackScheduledAt) {
      throw new ValidationError("A callback date and time is required when disposition is Call Back.");
    }
    const d = new Date(input.callbackScheduledAt);
    if (isNaN(d.getTime())) {
      throw new ValidationError("Invalid callback date and time format.");
    }
    callbackDate = d;
  } else if (input.callbackScheduledAt) {
    const d = new Date(input.callbackScheduledAt);
    if (!isNaN(d.getTime())) {
      callbackDate = d;
    }
  }

  // Determine property lifecycle transitions based on disposition
  let nextValidationStatus: SupplyValidationStatus = property.validationStatus;
  let nextAvailabilityStatus: PropertyAvailabilityStatus = property.availabilityStatus;
  let nextOwnerWillingness: boolean = property.ownerWillingnessConfirmed;

  switch (normalizedDisposition) {
    case PropertyCallingDisposition.RINGING_OR_NOT_ANSWERING:
    case PropertyCallingDisposition.CALL_BACK:
      // Transition from NOT_VALIDATED to IN_VALIDATION
      if (property.validationStatus === SupplyValidationStatus.NOT_VALIDATED) {
        nextValidationStatus = SupplyValidationStatus.IN_VALIDATION;
      }
      break;

    case PropertyCallingDisposition.TEMPORARILY_UNAVAILABLE:
      if (property.validationStatus === SupplyValidationStatus.NOT_VALIDATED) {
        nextValidationStatus = SupplyValidationStatus.IN_VALIDATION;
      }
      nextAvailabilityStatus = PropertyAvailabilityStatus.TEMPORARILY_UNAVAILABLE;
      break;

    case PropertyCallingDisposition.PROPERTY_SOLD_OR_RENTED:
      nextAvailabilityStatus =
        property.preference === TransactionType.RENT
          ? PropertyAvailabilityStatus.RENTED
          : PropertyAvailabilityStatus.SOLD;
      break;

    case PropertyCallingDisposition.OWNER_DECLINES_MANDATE:
      nextValidationStatus = SupplyValidationStatus.MANDATE_DECLINED;
      nextOwnerWillingness = false;
      break;

    case PropertyCallingDisposition.PROPERTY_AVAILABLE:
      if (input.confirmOwnerWillingness) {
        nextOwnerWillingness = true;
        nextValidationStatus = SupplyValidationStatus.VALIDATED;
        nextAvailabilityStatus = PropertyAvailabilityStatus.AVAILABLE;
      } else {
        nextOwnerWillingness = false;
        if (property.validationStatus === SupplyValidationStatus.NOT_VALIDATED) {
          nextValidationStatus = SupplyValidationStatus.IN_VALIDATION;
        }
        nextAvailabilityStatus = PropertyAvailabilityStatus.AVAILABLE;
      }
      break;
  }

  // Active supply eligibility: strictly requires confirmed willingness AND validated status AND available
  const computedIsActiveSupply = isEligibleForActiveSupply({
    ownerWillingnessConfirmed: nextOwnerWillingness,
    validationStatus: nextValidationStatus,
    availabilityStatus: nextAvailabilityStatus,
  });

  // Execute atomic transaction: create CallLog record and update Property
  const [, updatedProperty] = await prisma.$transaction([
    prisma.callLog.create({
      data: {
        tenantId: context.tenantId,
        callerId: context.userId, // Server context derivation
        callType: CallTargetType.PROPERTY_VALIDATION,
        propertyId: property.id,
        propertyDisposition: normalizedDisposition,
        notes: input.notes?.trim() || null,
        callbackScheduledAt: callbackDate,
        calledAt: new Date(),
      },
      include: {
        caller: true,
      },
    }),
    prisma.property.update({
      where: {
        id_tenantId: {
          id: property.id,
          tenantId: context.tenantId, // ATOMIC TENANT SCOPED MUTATION
        },
      },
      data: {
        validationStatus: nextValidationStatus,
        availabilityStatus: nextAvailabilityStatus,
        ownerWillingnessConfirmed: nextOwnerWillingness,
        isActiveSupply: computedIsActiveSupply,
      },
      include: {
        keyHolders: true,
        media: true,
        callLogs: {
          orderBy: { calledAt: "desc" },
          include: { caller: true },
        },
        assignments: {
          orderBy: { assignedAt: "desc" },
          include: {
            assignedUser: true,
            assignedByUser: true,
          },
        },
      },
    }),
  ]);

  return updatedProperty;
}
