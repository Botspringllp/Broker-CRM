import dotenv from "dotenv";
dotenv.config();

import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import { validateTestDatabaseUrl, assertLiveTestDatabaseSafety } from "../tests/integration/setup/db-guard";

async function main() {
  console.log("=================================================");
  console.log("🚀 Setting Up Dedicated Test Database");
  console.log("=================================================");

  // 1. Static URL & Safety Guard Validation
  const { url: testDbUrl, target } = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  console.log(`[Safety Guard] Target Verified: ${target.sanitizedUrl}`);

  // 2. Verify Docker Container Availability & Database Existence
  try {
    console.log("[Docker] Verifying container 'broker-crm-postgres' status...");
    const containerStatus = execSync('docker inspect -f "{{.State.Running}}" broker-crm-postgres', {
      encoding: "utf-8",
    }).trim();

    if (containerStatus !== "true") {
      throw new Error("Docker container 'broker-crm-postgres' is not running.");
    }
    console.log("[Docker] Container is running and healthy.");

    // Check if broker_crm_test exists
    console.log(`[PostgreSQL] Checking if database '${target.database}' exists...`);
    const checkDbCmd = `docker exec broker-crm-postgres psql -U broker_admin -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${target.database}';"`;
    const dbExists = execSync(checkDbCmd, { encoding: "utf-8" }).trim();

    if (dbExists === "1") {
      console.log(`[PostgreSQL] Database '${target.database}' already exists.`);
    } else {
      console.log(`[PostgreSQL] Database '${target.database}' does not exist. Creating...`);
      const createDbCmd = `docker exec broker-crm-postgres psql -U broker_admin -d postgres -c "CREATE DATABASE ${target.database} OWNER broker_admin ENCODING 'UTF8';"`;
      execSync(createDbCmd, { stdio: "inherit" });
      console.log(`[PostgreSQL] Database '${target.database}' created successfully.`);
    }
  } catch (err: unknown) {
    console.error("❌ Failed during database existence check or creation:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // 3. Apply Prisma Migrations to Test Database ONLY
  console.log("\n=================================================");
  console.log("📦 Applying Prisma Migrations to Test Database");
  console.log("=================================================");
  try {
    console.log(`[Prisma] Executing 'prisma migrate deploy' targeting ${target.sanitizedUrl}...`);
    execSync("npx prisma migrate deploy", {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: testDbUrl,
        DIRECT_URL: testDbUrl,
      },
    });
    console.log("[Prisma] Migrations applied successfully to test database.");
  } catch (err: unknown) {
    console.error("❌ Failed to apply migrations to test database:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // 4. Runtime Verification & Post-Migration Assertions
  console.log("\n=================================================");
  console.log("🔍 Verifying Post-Migration Integrity");
  console.log("=================================================");
  const testPrisma = new PrismaClient({
    datasources: { db: { url: testDbUrl } },
    log: ["error"],
  });

  try {
    await assertLiveTestDatabaseSafety(testPrisma);

    // Verify migrations table
    const migrations = await testPrisma.$queryRawUnsafe<
      Array<{ migration_name: string; finished_at: Date }>
    >("SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at ASC");

    console.log(`[Post-Check] Migrations applied in test DB: ${migrations.length}`);
    if (migrations.length < 9) {
      throw new Error(`Expected at least 9 migrations, found ${migrations.length}.`);
    }

    // Verify core tables exist
    const tables = await testPrisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
    );
    console.log(`[Post-Check] Base tables created in test DB: ${tables.length}`);
    const tableNames = tables.map((t) => t.table_name);
    const requiredTables = ["tenants", "users", "leads", "properties", "site_visits", "site_visit_items", "site_visit_access_links"];
    for (const reqTable of requiredTables) {
      if (!tableNames.includes(reqTable)) {
        throw new Error(`Required table '${reqTable}' was not found in test database.`);
      }
    }

    console.log("✅ Dedicated test database setup is complete and fully verified!");
  } finally {
    await testPrisma.$disconnect();
  }
}

main();
