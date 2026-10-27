"use server";

import { requireTenantContext, DuplicatePropertyError } from "@/server/tenant-context";
import {
  createProperty,
  checkDuplicateProperty,
  CreatePropertyInput,
} from "@/server/dal/properties";
import { mapPrismaPropertyToView } from "@/server/dal/mappers";
import { revalidatePath } from "next/cache";

export async function createPropertyAction(input: CreatePropertyInput) {
  try {
    const context = await requireTenantContext();
    const result = await createProperty(context, input);
    revalidatePath("/supply");
    revalidatePath("/supply/active");
    revalidatePath("/");
    return {
      success: true as const,
      property: mapPrismaPropertyToView(result),
    };
  } catch (err: unknown) {
    if (err instanceof DuplicatePropertyError) {
      return {
        success: false as const,
        isDuplicate: true,
        error: err.message,
        duplicateProperty: err.existingProperty,
      };
    }
    const message = err instanceof Error ? err.message : "Failed to create property.";
    return {
      success: false as const,
      isDuplicate: false,
      error: message,
    };
  }
}

export async function checkDuplicatePropertyAction(params: {
  societyName: string;
  flatNumber: string;
}) {
  try {
    const context = await requireTenantContext();
    const result = await checkDuplicateProperty(context, params);
    return { success: true, ...result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to check duplicate.";
    return { success: false, isDuplicate: false, duplicate: null, error: message };
  }
}

