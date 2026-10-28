"use server";

import { requireTenantContext } from "@/server/tenant-context";
import {
  startVerificationVisit,
  submitVerificationReport,
  recordUnableToVerify,
  reviewVerificationReport,
  SubmitVerificationInput,
  UnableToVerifyInput,
  ReviewVerificationInput,
} from "@/server/dal/verifications";
import {
  listEligibleFieldVerifiers,
  assignPropertyToFieldVerifier,
  AssignFieldVerifierInput,
} from "@/server/dal/assignments";
import { addPropertyPhoto } from "@/server/dal/media";
import { mapPrismaVerificationToView } from "@/server/dal/mappers";
import { revalidatePath } from "next/cache";

export async function startVerificationVisitAction(verificationId: string) {
  const context = await requireTenantContext();
  const updated = await startVerificationVisit(context, verificationId);
  revalidatePath("/verifier");
  revalidatePath("/verifier/assigned");
  revalidatePath(`/verifier/tasks/${verificationId}`);
  return { success: true, verification: mapPrismaVerificationToView(updated) };
}

export async function submitVerificationReportAction(input: SubmitVerificationInput) {
  const context = await requireTenantContext();
  const updated = await submitVerificationReport(context, input);
  revalidatePath("/verifier");
  revalidatePath("/verifier/assigned");
  revalidatePath("/verifier/completed");
  revalidatePath(`/verifier/tasks/${input.verificationId}`);
  revalidatePath("/supply/active");
  return { success: true, verification: mapPrismaVerificationToView(updated) };
}

export async function recordUnableToVerifyAction(input: UnableToVerifyInput) {
  const context = await requireTenantContext();
  const updated = await recordUnableToVerify(context, input);
  revalidatePath("/verifier");
  revalidatePath("/verifier/assigned");
  revalidatePath("/verifier/completed");
  revalidatePath(`/verifier/tasks/${input.verificationId}`);
  revalidatePath("/supply/active");
  return { success: true, verification: mapPrismaVerificationToView(updated) };
}

export async function uploadVerificationPhotoAction(formData: FormData) {
  const context = await requireTenantContext();
  const propertyId = formData.get("propertyId") as string;
  const verificationId = formData.get("verificationId") as string;
  const caption = (formData.get("caption") as string) || "";
  const file = formData.get("photo") as File;

  if (!propertyId || !verificationId || !file) {
    throw new Error("Property ID, Verification ID, and Photo file are required.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);

  const media = await addPropertyPhoto(context, {
    propertyId,
    verificationId,
    fileBuffer,
    originalFilename: file.name,
    caption,
  });

  revalidatePath(`/verifier/tasks/${verificationId}`);
  return {
    success: true,
    media: {
      id: media.id,
      url: media.url,
      caption: media.caption,
      mediaType: media.mediaType,
    },
  };
}

export async function listEligibleFieldVerifiersAction() {
  const context = await requireTenantContext();
  const verifiers = await listEligibleFieldVerifiers(context);
  return { success: true, verifiers };
}

export async function assignPropertyToFieldVerifierAction(input: AssignFieldVerifierInput) {
  const context = await requireTenantContext();
  const result = await assignPropertyToFieldVerifier(context, input);
  revalidatePath("/supply");
  revalidatePath("/supply/active");
  revalidatePath("/verifier");
  revalidatePath("/verifier/assigned");
  return {
    success: true,
    assignmentId: result.assignment.id,
    verificationId: result.verification.id,
  };
}

export async function reviewVerificationReportAction(input: ReviewVerificationInput) {
  const context = await requireTenantContext();
  const updated = await reviewVerificationReport(context, input);
  revalidatePath("/supply/active");
  revalidatePath("/verifier");
  revalidatePath("/verifier/assigned");
  revalidatePath("/verifier/completed");
  revalidatePath(`/verifier/tasks/${input.verificationId}`);
  return { success: true, verification: mapPrismaVerificationToView(updated) };
}
