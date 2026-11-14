import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  PrismaClient,
  UserRole,
  SiteVisitStatus,
  SiteVisitItemOutcome,
  BuyerInterestLevel,
  ScheduleChangeType,
  VisitPartyPersona,
  SupplyValidationStatus,
  PropertyAvailabilityStatus,
} from "@prisma/client";
import { getTestPrisma, disconnectTestDb } from "./helpers/db-client";
import {
  createTestTenant,
  createTestUser,
  createTestProperty,
  createTestLead,
  createTestContext,
  TestTenantFixture,
} from "./helpers/tenant-helper";
import {
  createSiteVisit,
  createSiteVisitAccessLink,
  confirmSiteVisit,
  rescheduleSiteVisit,
  reassignSiteVisitAgent,
  cancelSiteVisit,
  recordVisitItemOutcome,
} from "@/server/dal/visits";

describe("Live PostgreSQL Integration: Database Transactions & Atomicity", () => {
  let prisma: PrismaClient;
  let fixture: TestTenantFixture;

  beforeAll(async () => {
    prisma = await getTestPrisma();
    fixture = await createTestTenant(prisma, "Transaction Test Broker");
  });

  afterAll(async () => {
    await fixture?.cleanup();
    await disconnectTestDb();
  });

  it("proves complete transaction rollback: when an error is thrown inside $transaction, no partial writes persist", async () => {
    const uncommittedPhone = "9899112233";

    await expect(
      prisma.$transaction(async (tx) => {
        // Step 1: Write lead inside transaction
        await tx.lead.create({
          data: {
            tenantId: fixture.tenant.id,
            name: "Uncommitted Test Lead",
            primaryPhone: uncommittedPhone,
            originalSource: "MANUAL",
          },
        });

        // Step 2: Deliberate failure throwing inside transaction block
        throw new Error("Deliberate failure to trigger PostgreSQL rollback");
      })
    ).rejects.toThrow("Deliberate failure to trigger PostgreSQL rollback");

    // Verify in PostgreSQL: lead must NOT exist in the database
    const persisted = await prisma.lead.findFirst({
      where: {
        tenantId: fixture.tenant.id,
        primaryPhone: uncommittedPhone,
      },
    });

    expect(persisted).toBeNull();
  });

  it("atomically completes site visit, revokes active access links, and synchronizes BuyerPropertyInterest in confirmSiteVisit", async () => {
    const manager = await createTestUser(prisma, fixture.tenant.id, { role: UserRole.BROKER_OWNER });
    const agent = await createTestUser(prisma, fixture.tenant.id, { role: UserRole.FIELD_SALES_AGENT });
    const lead = await createTestLead(prisma, fixture.tenant.id, { name: "Tour Finalization Lead" });
    const property = await createTestProperty(prisma, fixture.tenant.id, {
      societyName: "Palm Springs Luxury",
      isActiveSupply: true,
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
    });

    const context = createTestContext(manager);

    // 1. Create a confirmed site visit with tomorrow's schedule
    const scheduledDate = new Date(Date.now() + 86400000);
    const visit = await createSiteVisit(context, {
      leadId: lead.id,
      assignedSalesAgentId: agent.id,
      scheduledDate: scheduledDate.toISOString(),
      propertyIds: [property.id],
    });

    // Mark visit as CONFIRMED for finalization
    await prisma.siteVisit.update({
      where: { id: visit.id },
      data: { status: SiteVisitStatus.CONFIRMED },
    });

    // 2. Generate active field agent access link
    const linkResult = await createSiteVisitAccessLink(context, visit.id);
    expect(linkResult.rawToken).toBeDefined();

    // Verify link is active initially
    const initialLink = await prisma.siteVisitAccessLink.findUnique({
      where: { id: linkResult.linkId },
    });
    expect(initialLink?.isRevoked).toBe(false);

    // 3. Record visit item outcome
    const item = visit.items[0];
    await recordVisitItemOutcome(context, item.id, {
      status: SiteVisitItemOutcome.VISIT_DONE,
      buyerInterestLevel: BuyerInterestLevel.HIGH,
      agentTextNotes: "Buyer liked the layout and floor plan",
      buyerFeedback: "Ready to proceed to offer stage",
    });

    // 4. Finalize the visit via confirmSiteVisit transaction
    const finalizedVisit = await confirmSiteVisit(
      context,
      visit.id,
      "Telecaller confirmed complete tour and buyer feedback."
    );

    expect(finalizedVisit.status).toBe(SiteVisitStatus.COMPLETED);

    // 5. Verify PostgreSQL atomic state
    // A: Site visit status is COMPLETED
    const dbVisit = await prisma.siteVisit.findUnique({
      where: { id: visit.id },
    });
    expect(dbVisit?.status).toBe(SiteVisitStatus.COMPLETED);
    expect(dbVisit?.telecallerConfirmedAt).not.toBeNull();

    // B: Access link was revoked in the same transaction
    const dbLink = await prisma.siteVisitAccessLink.findUnique({
      where: { id: linkResult.linkId },
    });
    expect(dbLink?.isRevoked).toBe(true);

    // C: BuyerPropertyInterest was created and synced
    const dbInterest = await prisma.buyerPropertyInterest.findUnique({
      where: {
        tenantId_leadId_propertyId: {
          tenantId: fixture.tenant.id,
          leadId: lead.id,
          propertyId: property.id,
        },
      },
    });
    expect(dbInterest).not.toBeNull();
    expect(dbInterest?.interestLevel).toBe(BuyerInterestLevel.HIGH);
    expect(dbInterest?.feedbackNotes).toBe("Ready to proceed to offer stage");
  });

  it("rolls back confirmSiteVisit when BuyerPropertyInterest upsert fails: visit remains uncompleted, access link remains active, and no interest is persisted", async () => {
    const manager = await createTestUser(prisma, fixture.tenant.id, { role: UserRole.BROKER_OWNER });
    const agent = await createTestUser(prisma, fixture.tenant.id, { role: UserRole.FIELD_SALES_AGENT });
    const lead = await createTestLead(prisma, fixture.tenant.id, { name: "Rollback Finalization Lead" });
    const property = await createTestProperty(prisma, fixture.tenant.id, {
      societyName: "Emerald Enclave",
      isActiveSupply: true,
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
    });

    const context = createTestContext(manager);

    // 1. Create a confirmed site visit with tomorrow's schedule
    const scheduledDate = new Date(Date.now() + 86400000);
    const visit = await createSiteVisit(context, {
      leadId: lead.id,
      assignedSalesAgentId: agent.id,
      scheduledDate: scheduledDate.toISOString(),
      propertyIds: [property.id],
    });

    await prisma.siteVisit.update({
      where: { id: visit.id },
      data: { status: SiteVisitStatus.CONFIRMED },
    });

    // 2. Generate active field agent access link
    const linkResult = await createSiteVisitAccessLink(context, visit.id);
    const initialLink = await prisma.siteVisitAccessLink.findUnique({
      where: { id: linkResult.linkId },
    });
    expect(initialLink?.isRevoked).toBe(false);

    // 3. Record visit item outcome
    const item = visit.items[0];
    await recordVisitItemOutcome(context, item.id, {
      status: SiteVisitItemOutcome.VISIT_DONE,
      buyerInterestLevel: BuyerInterestLevel.HIGH,
      agentTextNotes: "Great prospect",
      buyerFeedback: "Very interested",
    });

    // 4. Inject deterministic PostgreSQL-level trigger on buyer_property_interests scoped to this tenant
    const triggerName = `trg_fail_interest_${fixture.tenant.id.replace(/-/g, "_")}`;
    const funcName = `fn_fail_interest_${fixture.tenant.id.replace(/-/g, "_")}`;

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${funcName}() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW."tenantId" = '${fixture.tenant.id}' THEN
          RAISE EXCEPTION 'Simulated failure in BuyerPropertyInterest upsert for rollback test';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT OR UPDATE ON buyer_property_interests
      FOR EACH ROW EXECUTE FUNCTION ${funcName}();
    `);

    try {
      // 5. Invoke actual confirmSiteVisit DAL function - MUST reject due to trigger
      await expect(
        confirmSiteVisit(context, visit.id, "Attempt finalization that must fail inside transaction")
      ).rejects.toThrow(/Simulated failure in BuyerPropertyInterest upsert/);

      // 6. Verify PostgreSQL rollback guarantees:
      // A: Site visit status remains CONFIRMED (did NOT commit COMPLETED)
      const dbVisit = await prisma.siteVisit.findUnique({
        where: { id: visit.id },
      });
      expect(dbVisit?.status).toBe(SiteVisitStatus.CONFIRMED);
      expect(dbVisit?.telecallerConfirmedAt).toBeNull();

      // B: Access link remains active and unrevoked (did NOT commit revocation)
      const dbLink = await prisma.siteVisitAccessLink.findUnique({
        where: { id: linkResult.linkId },
      });
      expect(dbLink?.isRevoked).toBe(false);

      // C: BuyerPropertyInterest was NOT persisted
      const dbInterest = await prisma.buyerPropertyInterest.findUnique({
        where: {
          tenantId_leadId_propertyId: {
            tenantId: fixture.tenant.id,
            leadId: lead.id,
            propertyId: property.id,
          },
        },
      });
      expect(dbInterest).toBeNull();
    } finally {
      // 7. Clean up failure injection trigger & function
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON buyer_property_interests;`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${funcName}();`);
    }
  });

  it("atomically updates scheduled date, revokes access links, and writes schedule history in rescheduleSiteVisit", async () => {
    const manager = await createTestUser(prisma, fixture.tenant.id, { role: UserRole.BROKER_OWNER });
    const agent = await createTestUser(prisma, fixture.tenant.id, { role: UserRole.FIELD_SALES_AGENT });
    const lead = await createTestLead(prisma, fixture.tenant.id, { name: "Reschedule Prospect" });
    const property = await createTestProperty(prisma, fixture.tenant.id, {
      societyName: "Grand Central Towers",
      isActiveSupply: true,
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
    });

    const context = createTestContext(manager);

    const initialDate = new Date(Date.now() + 86400000); // 1 day ahead
    const newDate = new Date(Date.now() + 172800000); // 2 days ahead

    const visit = await createSiteVisit(context, {
      leadId: lead.id,
      assignedSalesAgentId: agent.id,
      scheduledDate: initialDate.toISOString(),
      propertyIds: [property.id],
    });

    // Generate active access link
    const linkResult = await createSiteVisitAccessLink(context, visit.id);
    expect(linkResult.linkId).toBeDefined();

    // Call rescheduleSiteVisit transaction
    const rescheduled = await rescheduleSiteVisit(context, {
      visitId: visit.id,
      newScheduledDate: newDate.toISOString(),
      reason: "Buyer requested postponement due to travel",
    });

    expect(new Date(rescheduled.scheduledDate).getTime()).toBe(newDate.getTime());

    // Verify in live PostgreSQL:
    // A: Access link was revoked
    const dbLink = await prisma.siteVisitAccessLink.findUnique({
      where: { id: linkResult.linkId },
    });
    expect(dbLink?.isRevoked).toBe(true);

    // B: Schedule history record was written
    const historyEntries = await prisma.siteVisitScheduleHistory.findMany({
      where: { siteVisitId: visit.id },
    });
    expect(historyEntries.length).toBe(1);
    expect(historyEntries[0].changeType).toBe(ScheduleChangeType.RESCHEDULED);
    expect(historyEntries[0].reason).toBe("Buyer requested postponement due to travel");
    expect(historyEntries[0].recordedByUserId).toBe(manager.id);
  });

  it("rolls back rescheduleSiteVisit when SiteVisitScheduleHistory creation fails: scheduled date is unchanged, access link remains active, and no history is persisted", async () => {
    const manager = await createTestUser(prisma, fixture.tenant.id, { role: UserRole.BROKER_OWNER });
    const agent = await createTestUser(prisma, fixture.tenant.id, { role: UserRole.FIELD_SALES_AGENT });
    const lead = await createTestLead(prisma, fixture.tenant.id, { name: "Rollback Reschedule Lead" });
    const property = await createTestProperty(prisma, fixture.tenant.id, {
      societyName: "Grand Central Residency",
      isActiveSupply: true,
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
    });

    const context = createTestContext(manager);

    const initialDate = new Date(Date.now() + 86400000); // 1 day ahead
    const newDate = new Date(Date.now() + 172800000); // 2 days ahead

    // 1. Create a valid site visit with an active access link
    const visit = await createSiteVisit(context, {
      leadId: lead.id,
      assignedSalesAgentId: agent.id,
      scheduledDate: initialDate.toISOString(),
      propertyIds: [property.id],
    });

    const linkResult = await createSiteVisitAccessLink(context, visit.id);
    const initialLink = await prisma.siteVisitAccessLink.findUnique({
      where: { id: linkResult.linkId },
    });
    expect(initialLink?.isRevoked).toBe(false);

    // 2. Inject deterministic PostgreSQL-level trigger on site_visit_schedule_history scoped to this tenant
    const triggerName = `trg_fail_history_${fixture.tenant.id.replace(/-/g, "_")}`;
    const funcName = `fn_fail_history_${fixture.tenant.id.replace(/-/g, "_")}`;

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${funcName}() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW."tenantId" = '${fixture.tenant.id}' THEN
          RAISE EXCEPTION 'Simulated failure in SiteVisitScheduleHistory insertion for rollback test';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON site_visit_schedule_history
      FOR EACH ROW EXECUTE FUNCTION ${funcName}();
    `);

    try {
      // 3. Invoke actual rescheduleSiteVisit DAL function - MUST reject due to trigger
      await expect(
        rescheduleSiteVisit(context, {
          visitId: visit.id,
          newScheduledDate: newDate.toISOString(),
          reason: "Trigger failure injection test",
        })
      ).rejects.toThrow(/Simulated failure in SiteVisitScheduleHistory insertion/);

      // 4. Verify PostgreSQL rollback guarantees:
      // A: Scheduled date is unchanged (did NOT update to newDate)
      const dbVisit = await prisma.siteVisit.findUnique({
        where: { id: visit.id },
      });
      expect(dbVisit?.scheduledDate.toISOString()).toBe(initialDate.toISOString());

      // B: Access link remains active and unrevoked (did NOT commit revocation)
      const dbLink = await prisma.siteVisitAccessLink.findUnique({
        where: { id: linkResult.linkId },
      });
      expect(dbLink?.isRevoked).toBe(false);

      // C: Zero schedule history records were persisted
      const historyEntries = await prisma.siteVisitScheduleHistory.findMany({
        where: { siteVisitId: visit.id },
      });
      expect(historyEntries.length).toBe(0);
    } finally {
      // 5. Clean up failure injection trigger & function
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON site_visit_schedule_history;`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${funcName}();`);
    }
  });

  it("atomically reassigns agent and revokes prior agent's access link in reassignSiteVisitAgent", async () => {
    const manager = await createTestUser(prisma, fixture.tenant.id, { role: UserRole.BROKER_OWNER });
    const agent1 = await createTestUser(prisma, fixture.tenant.id, { role: UserRole.FIELD_SALES_AGENT, name: "Agent One" });
    const agent2 = await createTestUser(prisma, fixture.tenant.id, { role: UserRole.FIELD_SALES_AGENT, name: "Agent Two" });
    const lead = await createTestLead(prisma, fixture.tenant.id, { name: "Reassign Prospect" });
    const property = await createTestProperty(prisma, fixture.tenant.id, {
      isActiveSupply: true,
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
    });

    const context = createTestContext(manager);

    const visit = await createSiteVisit(context, {
      leadId: lead.id,
      assignedSalesAgentId: agent1.id,
      scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      propertyIds: [property.id],
    });

    // Generate link for Agent 1
    const linkResult = await createSiteVisitAccessLink(context, visit.id);

    // Reassign visit to Agent 2
    const updatedVisit = await reassignSiteVisitAgent(context, {
      visitId: visit.id,
      newSalesAgentId: agent2.id,
      reason: "Agent One called in sick",
    });

    expect(updatedVisit.assignedSalesAgentId).toBe(agent2.id);

    // Verify in PostgreSQL:
    // A: SiteVisit assigned agent is updated to agent 2
    const dbVisit = await prisma.siteVisit.findUnique({
      where: { id: visit.id },
    });
    expect(dbVisit?.assignedSalesAgentId).toBe(agent2.id);

    // B: Agent 1's link is revoked
    const dbLink = await prisma.siteVisitAccessLink.findUnique({
      where: { id: linkResult.linkId },
    });
    expect(dbLink?.isRevoked).toBe(true);
  });

  it("atomically cancels site visit, revokes active links, and records schedule history in cancelSiteVisit", async () => {
    const manager = await createTestUser(prisma, fixture.tenant.id, { role: UserRole.BROKER_OWNER });
    const agent = await createTestUser(prisma, fixture.tenant.id, { role: UserRole.FIELD_SALES_AGENT });
    const lead = await createTestLead(prisma, fixture.tenant.id, { name: "Cancellation Prospect" });
    const property = await createTestProperty(prisma, fixture.tenant.id, {
      isActiveSupply: true,
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
    });

    const context = createTestContext(manager);

    const visit = await createSiteVisit(context, {
      leadId: lead.id,
      assignedSalesAgentId: agent.id,
      scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      propertyIds: [property.id],
    });

    // Generate link
    const linkResult = await createSiteVisitAccessLink(context, visit.id);

    // Cancel visit
    const cancelledVisit = await cancelSiteVisit(context, {
      visitId: visit.id,
      reason: "Buyer purchased another property elsewhere",
      cancelledByPersona: VisitPartyPersona.BUYER,
    });

    expect(cancelledVisit.status).toBe(SiteVisitStatus.CANCELLED);

    // Verify in live PostgreSQL:
    // A: Status is CANCELLED
    const dbVisit = await prisma.siteVisit.findUnique({
      where: { id: visit.id },
    });
    expect(dbVisit?.status).toBe(SiteVisitStatus.CANCELLED);

    // B: Link is revoked
    const dbLink = await prisma.siteVisitAccessLink.findUnique({
      where: { id: linkResult.linkId },
    });
    expect(dbLink?.isRevoked).toBe(true);

    // C: Schedule history contains CANCELLED event
    const history = await prisma.siteVisitScheduleHistory.findFirst({
      where: {
        siteVisitId: visit.id,
        changeType: ScheduleChangeType.CANCELLED,
      },
    });
    expect(history).not.toBeNull();
    expect(history?.reason).toBe("Buyer purchased another property elsewhere");
  });
});
