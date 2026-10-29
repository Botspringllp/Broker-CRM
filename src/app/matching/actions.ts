"use server";

import { requireTenantContext } from "@/server/tenant-context";
import {
  getMatchingPropertiesForLead,
  getMatchingLeadsForProperty,
} from "@/server/dal/matching";
import { assertPermission } from "@/server/permissions";
import { getPropertyById } from "@/server/dal/properties";
import { getLeadById } from "@/server/dal/leads";

export async function getMatchingPropertiesForLeadAction(leadId: string) {
  try {
    const context = await requireTenantContext();
    const result = await getMatchingPropertiesForLead(context, leadId);
    return {
      success: true as const,
      data: result,
    };
  } catch (err: unknown) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : "Failed to compute matching properties.",
    };
  }
}

export async function getMatchingLeadsForPropertyAction(propertyId: string) {
  try {
    const context = await requireTenantContext();
    const result = await getMatchingLeadsForProperty(context, propertyId);
    return {
      success: true as const,
      data: result,
    };
  } catch (err: unknown) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : "Failed to compute matching buyers.",
    };
  }
}

export async function sharePropertyDetailsWithLeadAction(leadId: string, propertyId: string) {
  try {
    const context = await requireTenantContext();
    assertPermission(context, "matching:share_details");

    const [lead, property] = await Promise.all([
      getLeadById(context, leadId),
      getPropertyById(context, propertyId),
    ]);

    // Ensure tenant consistency
    if (lead.tenantId !== context.tenantId || property.tenantId !== context.tenantId) {
      return {
        success: false as const,
        error: "Unauthorized cross-tenant operation.",
      };
    }

    return {
      success: true as const,
      message: `Property details for ${property.societyName} shared with ${lead.name} (${lead.primaryPhone}).`,
      sharedProperty: {
        societyName: property.societyName,
        locality: property.localityName,
        bedroomCount: property.bedroomCount,
        priceFormatted: `₹${Number(property.price).toLocaleString("en-IN")}`,
      },
    };
  } catch (err: unknown) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : "Failed to share property details.",
    };
  }
}

