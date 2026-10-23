/**
 * Development-Only Seed Script for Broker CRM (Milestone 1)
 * Strictly fictional demo data for testing multi-tenancy and RBAC.
 * No real contacts or production credentials.
 */

import { PrismaClient, UserRole, TransactionType, FurnishingStatus, PropertyType, AreaUnitType, ConstructionStatus, SupplyValidationStatus, PropertyAvailabilityStatus } from "@prisma/client";

const prisma = new PrismaClient();

export async function seedDevData() {
  console.log("Seeding development data for multi-tenancy & RBAC verification...");

  // 1. Create Tenants
  const apexTenant = await prisma.tenant.upsert({
    where: { slug: "apex-realty" },
    update: {},
    create: {
      name: "Apex Realty Advisors",
      slug: "apex-realty",
      isActive: true,
    },
  });

  const horizonTenant = await prisma.tenant.upsert({
    where: { slug: "horizon-properties" },
    update: {},
    create: {
      name: "Horizon Properties",
      slug: "horizon-properties",
      isActive: true,
    },
  });

  const platformTenant = await prisma.tenant.upsert({
    where: { slug: "platform" },
    update: {},
    create: {
      name: "Broker CRM Platform Administration",
      slug: "platform",
      isActive: true,
    },
  });

  // 2. Create Users across roles
  const users = [
    {
      email: "vikram.owner@apexrealty.in",
      name: "Vikram Mehta",
      phone: "+91 98000 00001",
      role: UserRole.BROKER_OWNER,
      tenantId: apexTenant.id,
    },
    {
      email: "sunil.manager@apexrealty.in",
      name: "Sunil Grover",
      phone: "+91 98000 00002",
      role: UserRole.TEAM_LEADER,
      tenantId: apexTenant.id,
    },
    {
      email: "pooja.telecaller@apexrealty.in",
      name: "Pooja Sharma",
      phone: "+91 98000 00003",
      role: UserRole.TELECALLER,
      tenantId: apexTenant.id,
    },
    {
      email: "rahul.sales@apexrealty.in",
      name: "Rahul Varma",
      phone: "+91 98000 00004",
      role: UserRole.FIELD_SALES_AGENT,
      tenantId: apexTenant.id,
    },
    {
      email: "anita.verifier@apexrealty.in",
      name: "Anita Desai",
      phone: "+91 98000 00005",
      role: UserRole.FIELD_VERIFIER,
      tenantId: apexTenant.id,
    },
    {
      email: "admin@apexrealty.in",
      name: "Apex CRM Admin",
      phone: "+91 98000 00006",
      role: UserRole.CRM_TENANT_ADMIN,
      tenantId: apexTenant.id,
    },
    // Cross-tenant user in Horizon
    {
      email: "rohit.telecaller@horizon.in",
      name: "Rohit Kadam",
      phone: "+91 98000 00007",
      role: UserRole.TELECALLER,
      tenantId: horizonTenant.id,
    },
    // Platform Super Admin
    {
      email: "superadmin@brokercrm.internal",
      name: "Platform Super Admin",
      phone: "+91 98000 00099",
      role: UserRole.PLATFORM_SUPER_ADMIN,
      tenantId: platformTenant.id,
    },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role, tenantId: u.tenantId },
      create: {
        ...u,
        emailVerified: true,
        isActive: true,
      },
    });
  }

  // 3. Create Sample Properties in both tenants for cross-tenant isolation testing
  const apexProp = await prisma.property.upsert({
    where: { id_tenantId: { id: "apex-prop-1", tenantId: apexTenant.id } },
    update: {},
    create: {
      id: "apex-prop-1",
      tenantId: apexTenant.id,
      societyName: "DLF The Camellias",
      flatNumber: "Tower 2, Flat 1401",
      localityName: "Golf Course Road",
      city: "Gurgaon",
      preference: TransactionType.SALE,
      furnishingStatus: FurnishingStatus.SEMI_FURNISHED,
      propertyType: PropertyType.APARTMENT,
      area: 7400,
      areaType: AreaUnitType.SUPER_BUILT_UP,
      bedroomCount: 4,
      bathroomCount: 5,
      balconyCount: 3,
      price: 285000000,
      constructionStatus: ConstructionStatus.READY_TO_MOVE,
      ownerName: "H. Singhania",
      ownerMobile: "+91 98110 00012",
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
      isActiveSupply: true,
    },
  });

  const horizonProp = await prisma.property.upsert({
    where: { id_tenantId: { id: "horizon-prop-1", tenantId: horizonTenant.id } },
    update: {},
    create: {
      id: "horizon-prop-1",
      tenantId: horizonTenant.id,
      societyName: "Hiranandani Castle Rock",
      flatNumber: "Tower 5, Flat 1204",
      localityName: "Powai",
      city: "Mumbai",
      preference: TransactionType.RENT,
      furnishingStatus: FurnishingStatus.FURNISHED,
      propertyType: PropertyType.APARTMENT,
      area: 1050,
      areaType: AreaUnitType.CARPET,
      bedroomCount: 2,
      bathroomCount: 2,
      balconyCount: 1,
      price: 85000,
      constructionStatus: ConstructionStatus.READY_TO_MOVE,
      ownerName: "S. Agarwal",
      ownerMobile: "+91 98330 00034",
      validationStatus: SupplyValidationStatus.VALIDATED,
      availabilityStatus: PropertyAvailabilityStatus.AVAILABLE,
      isActiveSupply: true,
    },
  });

  console.log("Seed completed successfully:", {
    tenants: [apexTenant.slug, horizonTenant.slug, platformTenant.slug],
    apexProperty: apexProp.id,
    horizonProperty: horizonProp.id,
  });
}

// Allow direct CLI execution if executed with tsx / node
if (require.main === module) {
  seedDevData()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
