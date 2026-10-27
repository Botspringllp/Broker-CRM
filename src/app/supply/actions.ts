"use server";

import { requireTenantContext, DuplicatePropertyError } from "@/server/tenant-context";
import {
  createProperty,
  checkDuplicateProperty,
  logPropertyCall,
  getPropertyById,
  CreatePropertyInput,
  LogPropertyCallInput,
  assignPropertyManually,
  assignPropertyRoundRobin,
  listEligibleTelecallers,
  getPropertyAssignmentHistory,
  AssignPropertyInput,
  RoundRobinPropertyInput,
} from "@/server/dal/properties";
import {
  generateImportTemplate,
  parseAndPreviewImportFile,
  executeBulkPropertyImport,
  BulkImportExecutionInput,
} from "@/server/dal/bulk-import";
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

export async function logPropertyCallAction(input: LogPropertyCallInput) {
  try {
    const context = await requireTenantContext();
    const result = await logPropertyCall(context, input);
    revalidatePath("/supply");
    revalidatePath("/supply/active");
    revalidatePath("/");
    return {
      success: true as const,
      property: mapPrismaPropertyToView(result),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record call outcome.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function assignPropertyAction(input: AssignPropertyInput) {
  try {
    const context = await requireTenantContext();
    await assignPropertyManually(context, input);
    const updatedProperty = await getPropertyById(context, input.propertyId);
    revalidatePath("/supply");
    revalidatePath("/supply/active");
    revalidatePath("/");
    return {
      success: true as const,
      property: mapPrismaPropertyToView(updatedProperty),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to assign property.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function assignPropertyRoundRobinAction(input: RoundRobinPropertyInput) {
  try {
    const context = await requireTenantContext();
    await assignPropertyRoundRobin(context, input);
    const updatedProperty = await getPropertyById(context, input.propertyId);
    revalidatePath("/supply");
    revalidatePath("/supply/active");
    revalidatePath("/");
    return {
      success: true as const,
      property: mapPrismaPropertyToView(updatedProperty),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to execute round-robin assignment.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function getEligibleTelecallersAction() {
  try {
    const context = await requireTenantContext();
    const telecallers = await listEligibleTelecallers(context);
    return {
      success: true as const,
      telecallers,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch eligible telecallers.";
    return {
      success: false as const,
      error: message,
      telecallers: [],
    };
  }
}

export async function getPropertyAssignmentHistoryAction(propertyId: string) {
  try {
    const context = await requireTenantContext();
    const history = await getPropertyAssignmentHistory(context, propertyId);
    return {
      success: true as const,
      history,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch assignment history.";
    return {
      success: false as const,
      error: message,
      history: [],
    };
  }
}

export async function downloadImportTemplateAction(format: "csv" | "xlsx") {
  try {
    await requireTenantContext();
    const buffer = await generateImportTemplate(format);
    return {
      success: true as const,
      base64: buffer.toString("base64"),
      filename: format === "csv" ? "property_import_template.csv" : "property_import_template.xlsx",
      mimeType:
        format === "csv"
          ? "text/csv"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate import template.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function previewBulkPropertyUploadAction(formData: FormData) {
  try {
    const context = await requireTenantContext();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return {
        success: false as const,
        error: "No file was selected for upload.",
      };
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const preview = await parseAndPreviewImportFile(context, buffer, file.name);
    return {
      success: true as const,
      preview,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to parse import file.";
    return {
      success: false as const,
      error: message,
    };
  }
}

export async function confirmBulkPropertyUploadAction(input: BulkImportExecutionInput) {
  try {
    const context = await requireTenantContext();
    const result = await executeBulkPropertyImport(context, input);
    revalidatePath("/supply");
    revalidatePath("/supply/active");
    revalidatePath("/");
    return {
      success: true as const,
      result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to execute bulk property import.";
    return {
      success: false as const,
      error: message,
    };
  }
}


