import { prisma } from "../db";
import { TenantContext, NotFoundError } from "../tenant-context";
import { assertPermission } from "../permissions";
import { Prisma, UserRole } from "@prisma/client";

/**
 * Lists leads strictly scoped to the authenticated tenant.
 * Telecallers are restricted to their assigned leads by default per PRD §5.6.
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

  // Telecaller scoping: only assigned leads unless Manager/Owner
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
 * Retrieves a lead by ID strictly scoped to the authenticated tenant.
 * Throws NotFoundError if not found or belongs to another tenant.
 */
export async function getLeadById(context: TenantContext, leadId: string) {
  assertPermission(context, "demand:view_assigned");

  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
      tenantId: context.tenantId, // STRICT TENANT SCOPE
    },
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
 * Updates a lead atomically enforcing tenant scope using compound unique key.
 */
export async function updateLead(
  context: TenantContext,
  leadId: string,
  data: Prisma.LeadUpdateInput
) {
  assertPermission(context, "demand:log_call");

  // Verify existence in tenant before mutating
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

