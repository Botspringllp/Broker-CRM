import { prisma } from "../db";
import { TenantContext, NotFoundError } from "../tenant-context";
import { assertPermission } from "../permissions";
import { Prisma, UserRole } from "@prisma/client";

/**
 * Lists leads strictly scoped to the authenticated tenant.
 * - Telecallers are strictly restricted to their assigned leads.
 * - Field Verifiers, Sales Agents, and Tenant Admins have zero operational demand access.
 */
export async function listLeads(
  context: TenantContext,
  filters?: {
    status?: Prisma.EnumLeadStatusFilter;
    preference?: Prisma.EnumTransactionTypeFilter;
    city?: string;
    searchTerm?: string;
  }
) {
  assertPermission(context, "demand:view_assigned");

  const where: Prisma.LeadWhereInput = {
    tenantId: context.tenantId, // STRICT TENANT ENFORCEMENT
  };

  // Telecaller scoping: only assigned leads
  if (context.role === UserRole.TELECALLER) {
    where.assignedTelecallerId = context.userId;
  }

  if (filters?.status) where.status = filters.status;
  if (filters?.city) {
    where.requirement = { city: filters.city };
  }

  if (filters?.searchTerm) {
    where.OR = [
      { name: { contains: filters.searchTerm, mode: "insensitive" } },
      { primaryPhone: { contains: filters.searchTerm } },
    ];
  }

  return prisma.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      requirement: {
        include: {
          localities: {
            include: { locality: true },
          },
        },
      },
      enquiries: true,
      callLogs: {
        orderBy: { calledAt: "desc" },
      },
    },
  });
}

/**
 * Retrieves a lead by ID strictly scoped to the authenticated tenant and role assignment.
 * Throws NotFoundError if not found, belongs to another tenant, or not assigned to the Telecaller.
 */
export async function getLeadById(context: TenantContext, leadId: string) {
  assertPermission(context, "demand:view_assigned");

  const where: Prisma.LeadWhereInput = {
    id: leadId,
    tenantId: context.tenantId, // STRICT TENANT SCOPE
  };

  // Telecallers cannot access unassigned leads through direct URLs or APIs
  if (context.role === UserRole.TELECALLER) {
    where.assignedTelecallerId = context.userId;
  }

  const lead = await prisma.lead.findFirst({
    where,
    include: {
      requirement: true,
      enquiries: true,
      callLogs: {
        orderBy: { calledAt: "desc" },
      },
    },
  });

  if (!lead) {
    throw new NotFoundError("Lead not found.");
  }

  return lead;
}

/**
 * Creates a lead within the tenant context.
 */
export async function createLead(
  context: TenantContext,
  data: {
    name: string;
    primaryPhone: string;
    alternatePhone?: string;
    email?: string;
    originalSource: string;
    minBudget: number;
    maxBudget: number;
    city: string;
    preference: "SALE" | "RENT";
    bedroomConfigurations?: string[];
    propertyTypes?: ("APARTMENT" | "INDEPENDENT_HOUSE" | "VILLA" | "BUILDER_FLOOR" | "PLOT")[];
  }
) {
  assertPermission(context, "demand:create");

  return prisma.lead.create({
    data: {
      tenantId: context.tenantId,
      name: data.name,
      primaryPhone: data.primaryPhone,
      alternatePhone: data.alternatePhone,
      email: data.email,
      originalSource: data.originalSource,
      assignedTelecallerId: context.role === UserRole.TELECALLER ? context.userId : undefined,
      status: "NOT_YET_VALIDATED",
      requirement: {
        create: {
          tenantId: context.tenantId,
          minBudget: new Prisma.Decimal(data.minBudget),
          maxBudget: new Prisma.Decimal(data.maxBudget),
          city: data.city,
          preference: data.preference,
          bedroomConfigurations: data.bedroomConfigurations ?? [],
          propertyTypes: data.propertyTypes ?? [],
        },
      },
    },
    include: {
      requirement: true,
      enquiries: true,
      callLogs: true,
    },
  });
}

/**
 * Updates a lead atomically enforcing tenant scope and permission checks.
 * Activating a lead requires 'demand:activate'; inactiving requires 'demand:inactivate'.
 */
export async function updateLead(
  context: TenantContext,
  leadId: string,
  data: Prisma.LeadUpdateInput
) {
  // Check permission depending on mutation type
  if (
    data.status === "ACTIVE" ||
    (typeof data.status === "object" && (data.status as { set?: string }).set === "ACTIVE")
  ) {
    assertPermission(context, "demand:activate");
  } else if (
    data.status === "INACTIVE" ||
    (typeof data.status === "object" && (data.status as { set?: string }).set === "INACTIVE")
  ) {
    assertPermission(context, "demand:inactivate");
  } else {
    assertPermission(context, "demand:log_call");
  }

  // Verify existence in tenant and role scope before mutating
  await getLeadById(context, leadId);

  return prisma.lead.update({
    where: {
      id_tenantId: {
        id: leadId,
        tenantId: context.tenantId, // ATOMIC TENANT SCOPED MUTATION
      },
    },
    data,
  });
}
