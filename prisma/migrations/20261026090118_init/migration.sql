-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('BROKER_OWNER', 'TEAM_LEADER', 'TELECALLER', 'FIELD_VERIFIER', 'FIELD_SALES_AGENT', 'CRM_TENANT_ADMIN', 'PLATFORM_SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('SALE', 'RENT');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'INDEPENDENT_HOUSE', 'VILLA', 'BUILDER_FLOOR', 'PLOT', 'COMMERCIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "FurnishingStatus" AS ENUM ('UNFURNISHED', 'SEMI_FURNISHED', 'FURNISHED');

-- CreateEnum
CREATE TYPE "AreaUnitType" AS ENUM ('CARPET', 'BUILT_UP', 'SUPER_BUILT_UP');

-- CreateEnum
CREATE TYPE "ConstructionStatus" AS ENUM ('READY_TO_MOVE', 'UNDER_CONSTRUCTION');

-- CreateEnum
CREATE TYPE "PropertyEntryChannel" AS ENUM ('BULK_UPLOAD', 'MANUAL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "SupplyValidationStatus" AS ENUM ('NOT_VALIDATED', 'IN_VALIDATION', 'VALIDATED', 'MANDATE_DECLINED');

-- CreateEnum
CREATE TYPE "PropertyAvailabilityStatus" AS ENUM ('AVAILABLE', 'TEMPORARILY_UNAVAILABLE', 'SOLD', 'RENTED');

-- CreateEnum
CREATE TYPE "PropertyCallingDisposition" AS ENUM ('PROPERTY_AVAILABLE', 'PROPERTY_SOLD_OR_RENTED', 'OWNER_DECLINES_MANDATE', 'TEMPORARILY_UNAVAILABLE', 'CALL_BACK', 'RINGING_OR_NOT_ANSWERING');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NOT_YET_VALIDATED', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "LeadCallingDisposition" AS ENUM ('RINGING_OR_NOT_ANSWERING', 'CALL_BACK', 'CONNECTED', 'BUYER_SAYS_NOT_LOOKING');

-- CreateEnum
CREATE TYPE "CallTargetType" AS ENUM ('PROPERTY_VALIDATION', 'LEAD_VALIDATION');

-- CreateEnum
CREATE TYPE "AssignmentTargetType" AS ENUM ('PROPERTY', 'LEAD', 'SITE_VISIT');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('TELECALLER_VALIDATION', 'TELECALLER_FOLLOWUP', 'FIELD_VERIFIER', 'FIELD_SALES_AGENT');

-- CreateEnum
CREATE TYPE "AssignmentMethod" AS ENUM ('ROUND_ROBIN', 'MANUAL');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'REASSIGNED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SiteVisitStatus" AS ENUM ('TENTATIVE_AWAITING_OWNER', 'CONFIRMED', 'COMPLETED', 'NOT_COMPLETED', 'CANCELLED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "SiteVisitItemOutcome" AS ENUM ('PENDING', 'VISIT_DONE', 'VISIT_NOT_DONE');

-- CreateEnum
CREATE TYPE "VisitOutcomeEntryChannel" AS ENUM ('FIELD_AGENT_DIRECT', 'TELECALLER_ON_BEHALF');

-- CreateEnum
CREATE TYPE "VisitPartyPersona" AS ENUM ('OWNER', 'BUYER', 'BROKER');

-- CreateEnum
CREATE TYPE "ScheduleChangeType" AS ENUM ('RESCHEDULED', 'DELAYED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BuyerInterestLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'NOT_INTERESTED');

-- CreateEnum
CREATE TYPE "RentalRevalidationStatus" AS ENUM ('NONE', 'DUE', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('PHOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "MediaStorageProvider" AS ENUM ('OBJECT_STORAGE', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "KeyHolderPersona" AS ENUM ('GUARD', 'MAINTENANCE_OFFICE', 'NEIGHBOUR', 'OWNER', 'OTHER');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "phone" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "password" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "localities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "pincode" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "localities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "flatNumber" TEXT NOT NULL,
    "societyName" TEXT NOT NULL,
    "localityId" TEXT,
    "localityName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "preference" "TransactionType" NOT NULL,
    "furnishingStatus" "FurnishingStatus" NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "area" DECIMAL(12,2) NOT NULL,
    "areaType" "AreaUnitType" NOT NULL,
    "bedroomCount" INTEGER NOT NULL,
    "bathroomCount" INTEGER NOT NULL,
    "balconyCount" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(14,2) NOT NULL,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "constructionStatus" "ConstructionStatus" NOT NULL,
    "ownerName" TEXT NOT NULL,
    "ownerMobile" TEXT NOT NULL,
    "validationStatus" "SupplyValidationStatus" NOT NULL DEFAULT 'NOT_VALIDATED',
    "availabilityStatus" "PropertyAvailabilityStatus" NOT NULL DEFAULT 'AVAILABLE',
    "isActiveSupply" BOOLEAN NOT NULL DEFAULT false,
    "rentedAt" TIMESTAMP(3),
    "rentalAgreementMonths" INTEGER NOT NULL DEFAULT 11,
    "revalidationStatus" "RentalRevalidationStatus" NOT NULL DEFAULT 'NONE',
    "revalidationDueDate" TIMESTAMP(3),
    "entryChannel" "PropertyEntryChannel" NOT NULL DEFAULT 'MANUAL',
    "submittingAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_holders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "persona" "KeyHolderPersona" NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "key_holders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_media" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "storageProvider" "MediaStorageProvider" NOT NULL DEFAULT 'OBJECT_STORAGE',
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primaryPhone" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "email" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NOT_YET_VALIDATED',
    "unreachableAttemptsCount" INTEGER NOT NULL DEFAULT 0,
    "originalSource" TEXT NOT NULL,
    "sourceCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedTelecallerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "advertisedPropertyRef" TEXT,
    "advertisedPropertyId" TEXT,
    "enquiryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enquiryDetails" TEXT,
    "isVerifiedByCaller" BOOLEAN NOT NULL DEFAULT false,
    "callerVerificationNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_requirements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "minBudget" DECIMAL(14,2) NOT NULL,
    "maxBudget" DECIMAL(14,2) NOT NULL,
    "city" TEXT NOT NULL,
    "societies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bedroomConfigurations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minBedrooms" INTEGER,
    "maxBedrooms" INTEGER,
    "preference" "TransactionType" NOT NULL,
    "propertyTypes" "PropertyType"[] DEFAULT ARRAY[]::"PropertyType"[],
    "targetArea" DECIMAL(12,2),
    "areaType" "AreaUnitType",
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_requirement_localities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "localityId" TEXT NOT NULL,

    CONSTRAINT "lead_requirement_localities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_change_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "changedByUserId" TEXT,
    "changeSource" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "callType" "CallTargetType" NOT NULL,
    "propertyId" TEXT,
    "leadId" TEXT,
    "propertyDisposition" "PropertyCallingDisposition",
    "leadDisposition" "LeadCallingDisposition",
    "notes" TEXT,
    "callbackScheduledAt" TIMESTAMP(3),
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetType" "AssignmentTargetType" NOT NULL,
    "propertyId" TEXT,
    "leadId" TEXT,
    "siteVisitId" TEXT,
    "assignedUserId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "roleInAssignment" "AssignmentRole" NOT NULL,
    "assignmentMethod" "AssignmentMethod" NOT NULL DEFAULT 'MANUAL',
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_property_interests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "interestLevel" "BuyerInterestLevel" NOT NULL DEFAULT 'MEDIUM',
    "feedbackNotes" TEXT,
    "isShortlisted" BOOLEAN NOT NULL DEFAULT false,
    "sharedWithBuyerAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_property_interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_visits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "assignedSalesAgentId" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "status" "SiteVisitStatus" NOT NULL DEFAULT 'TENTATIVE_AWAITING_OWNER',
    "telecallerConfirmedAt" TIMESTAMP(3),
    "telecallerConfirmedByUserId" TEXT,
    "cancellationReason" TEXT,
    "cancelledByPersona" "VisitPartyPersona",
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_visit_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteVisitId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "visitOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "SiteVisitItemOutcome" NOT NULL DEFAULT 'PENDING',
    "reportedOutcomeAt" TIMESTAMP(3),
    "reportedByUserId" TEXT,
    "enteredByUserId" TEXT NOT NULL,
    "entryChannel" "VisitOutcomeEntryChannel" NOT NULL DEFAULT 'FIELD_AGENT_DIRECT',
    "agentTextNotes" TEXT,
    "voiceNoteUrl" TEXT,
    "voiceNoteDurationSeconds" INTEGER,
    "buyerFeedback" TEXT,
    "buyerInterestLevel" "BuyerInterestLevel",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_visit_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_visit_schedule_history" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteVisitId" TEXT NOT NULL,
    "previousScheduledAt" TIMESTAMP(3) NOT NULL,
    "newScheduledAt" TIMESTAMP(3),
    "changeType" "ScheduleChangeType" NOT NULL,
    "reason" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_visit_schedule_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_visit_access_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteVisitId" TEXT NOT NULL,
    "salesAgentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "accessedAt" TIMESTAMP(3),
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_visit_access_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenantId_role_idx" ON "users"("tenantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_tenantId_userId_idx" ON "sessions"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_providerId_accountId_key" ON "accounts"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE INDEX "localities_tenantId_city_idx" ON "localities"("tenantId", "city");

-- CreateIndex
CREATE UNIQUE INDEX "localities_tenantId_city_name_key" ON "localities"("tenantId", "city", "name");

-- CreateIndex
CREATE INDEX "properties_tenantId_validationStatus_idx" ON "properties"("tenantId", "validationStatus");

-- CreateIndex
CREATE INDEX "properties_tenantId_availabilityStatus_idx" ON "properties"("tenantId", "availabilityStatus");

-- CreateIndex
CREATE INDEX "properties_tenantId_isActiveSupply_idx" ON "properties"("tenantId", "isActiveSupply");

-- CreateIndex
CREATE INDEX "properties_tenantId_city_preference_idx" ON "properties"("tenantId", "city", "preference");

-- CreateIndex
CREATE INDEX "properties_tenantId_price_idx" ON "properties"("tenantId", "price");

-- CreateIndex
CREATE INDEX "properties_tenantId_revalidationStatus_idx" ON "properties"("tenantId", "revalidationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "properties_id_tenantId_key" ON "properties"("id", "tenantId");

-- CreateIndex
CREATE INDEX "key_holders_tenantId_propertyId_idx" ON "key_holders"("tenantId", "propertyId");

-- CreateIndex
CREATE INDEX "property_media_tenantId_propertyId_idx" ON "property_media"("tenantId", "propertyId");

-- CreateIndex
CREATE INDEX "leads_tenantId_status_idx" ON "leads"("tenantId", "status");

-- CreateIndex
CREATE INDEX "leads_tenantId_assignedTelecallerId_idx" ON "leads"("tenantId", "assignedTelecallerId");

-- CreateIndex
CREATE UNIQUE INDEX "leads_id_tenantId_key" ON "leads"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenantId_primaryPhone_key" ON "leads"("tenantId", "primaryPhone");

-- CreateIndex
CREATE INDEX "enquiries_tenantId_leadId_idx" ON "enquiries"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "enquiries_tenantId_advertisedPropertyId_idx" ON "enquiries"("tenantId", "advertisedPropertyId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_requirements_leadId_key" ON "lead_requirements"("leadId");

-- CreateIndex
CREATE INDEX "lead_requirements_tenantId_city_preference_idx" ON "lead_requirements"("tenantId", "city", "preference");

-- CreateIndex
CREATE INDEX "lead_requirement_localities_tenantId_localityId_idx" ON "lead_requirement_localities"("tenantId", "localityId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_requirement_localities_requirementId_localityId_key" ON "lead_requirement_localities"("requirementId", "localityId");

-- CreateIndex
CREATE INDEX "lead_change_logs_tenantId_leadId_changedAt_idx" ON "lead_change_logs"("tenantId", "leadId", "changedAt");

-- CreateIndex
CREATE INDEX "call_logs_tenantId_propertyId_calledAt_idx" ON "call_logs"("tenantId", "propertyId", "calledAt");

-- CreateIndex
CREATE INDEX "call_logs_tenantId_leadId_calledAt_idx" ON "call_logs"("tenantId", "leadId", "calledAt");

-- CreateIndex
CREATE INDEX "call_logs_tenantId_callerId_idx" ON "call_logs"("tenantId", "callerId");

-- CreateIndex
CREATE INDEX "call_logs_tenantId_callbackScheduledAt_idx" ON "call_logs"("tenantId", "callbackScheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "call_logs_id_tenantId_key" ON "call_logs"("id", "tenantId");

-- CreateIndex
CREATE INDEX "assignments_tenantId_targetType_status_idx" ON "assignments"("tenantId", "targetType", "status");

-- CreateIndex
CREATE INDEX "assignments_tenantId_assignedUserId_status_idx" ON "assignments"("tenantId", "assignedUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_id_tenantId_key" ON "assignments"("id", "tenantId");

-- CreateIndex
CREATE INDEX "buyer_property_interests_tenantId_propertyId_idx" ON "buyer_property_interests"("tenantId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_property_interests_tenantId_leadId_propertyId_key" ON "buyer_property_interests"("tenantId", "leadId", "propertyId");

-- CreateIndex
CREATE INDEX "site_visits_tenantId_leadId_scheduledDate_idx" ON "site_visits"("tenantId", "leadId", "scheduledDate");

-- CreateIndex
CREATE INDEX "site_visits_tenantId_assignedSalesAgentId_scheduledDate_idx" ON "site_visits"("tenantId", "assignedSalesAgentId", "scheduledDate");

-- CreateIndex
CREATE INDEX "site_visits_tenantId_status_idx" ON "site_visits"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "site_visits_id_tenantId_key" ON "site_visits"("id", "tenantId");

-- CreateIndex
CREATE INDEX "site_visit_items_tenantId_propertyId_idx" ON "site_visit_items"("tenantId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "site_visit_items_tenantId_siteVisitId_propertyId_key" ON "site_visit_items"("tenantId", "siteVisitId", "propertyId");

-- CreateIndex
CREATE INDEX "site_visit_schedule_history_tenantId_siteVisitId_createdAt_idx" ON "site_visit_schedule_history"("tenantId", "siteVisitId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "site_visit_access_links_tokenHash_key" ON "site_visit_access_links"("tokenHash");

-- CreateIndex
CREATE INDEX "site_visit_access_links_tenantId_siteVisitId_idx" ON "site_visit_access_links"("tenantId", "siteVisitId");

-- CreateIndex
CREATE INDEX "site_visit_access_links_tokenHash_idx" ON "site_visit_access_links"("tokenHash");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "localities" ADD CONSTRAINT "localities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "localities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_submittingAgentId_fkey" FOREIGN KEY ("submittingAgentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_holders" ADD CONSTRAINT "key_holders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_holders" ADD CONSTRAINT "key_holders_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedTelecallerId_fkey" FOREIGN KEY ("assignedTelecallerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_advertisedPropertyId_fkey" FOREIGN KEY ("advertisedPropertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requirements" ADD CONSTRAINT "lead_requirements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requirements" ADD CONSTRAINT "lead_requirements_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requirement_localities" ADD CONSTRAINT "lead_requirement_localities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requirement_localities" ADD CONSTRAINT "lead_requirement_localities_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "lead_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requirement_localities" ADD CONSTRAINT "lead_requirement_localities_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "localities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_change_logs" ADD CONSTRAINT "lead_change_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_change_logs" ADD CONSTRAINT "lead_change_logs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_change_logs" ADD CONSTRAINT "lead_change_logs_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_siteVisitId_fkey" FOREIGN KEY ("siteVisitId") REFERENCES "site_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_property_interests" ADD CONSTRAINT "buyer_property_interests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_property_interests" ADD CONSTRAINT "buyer_property_interests_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_property_interests" ADD CONSTRAINT "buyer_property_interests_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_assignedSalesAgentId_fkey" FOREIGN KEY ("assignedSalesAgentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_telecallerConfirmedByUserId_fkey" FOREIGN KEY ("telecallerConfirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visit_items" ADD CONSTRAINT "site_visit_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visit_items" ADD CONSTRAINT "site_visit_items_siteVisitId_fkey" FOREIGN KEY ("siteVisitId") REFERENCES "site_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visit_items" ADD CONSTRAINT "site_visit_items_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visit_items" ADD CONSTRAINT "site_visit_items_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visit_items" ADD CONSTRAINT "site_visit_items_enteredByUserId_fkey" FOREIGN KEY ("enteredByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visit_schedule_history" ADD CONSTRAINT "site_visit_schedule_history_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visit_schedule_history" ADD CONSTRAINT "site_visit_schedule_history_siteVisitId_fkey" FOREIGN KEY ("siteVisitId") REFERENCES "site_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visit_schedule_history" ADD CONSTRAINT "site_visit_schedule_history_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visit_access_links" ADD CONSTRAINT "site_visit_access_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visit_access_links" ADD CONSTRAINT "site_visit_access_links_siteVisitId_fkey" FOREIGN KEY ("siteVisitId") REFERENCES "site_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visit_access_links" ADD CONSTRAINT "site_visit_access_links_salesAgentId_fkey" FOREIGN KEY ("salesAgentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
