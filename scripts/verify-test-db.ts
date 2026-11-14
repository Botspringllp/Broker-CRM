import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { validateTestDatabaseUrl, assertLiveTestDatabaseSafety } from "../tests/integration/setup/db-guard";

async function main() {
  console.log("=================================================");
  console.log("🔍 Verifying Isolated Test Database Configuration");
  console.log("=================================================");

  try {
    const { target } = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    console.log(`[Safety Guard] URL Validation: Passed`);
    console.log(`[Target] Host: ${target.host}:${target.port}`);
    console.log(`[Target] Database: ${target.database}`);
    console.log(`[Target] Sanitized: ${target.sanitizedUrl}`);

    const prisma = new PrismaClient({
      datasources: {
        db: { url: process.env.TEST_DATABASE_URL },
      },
      log: ["error"],
    });

    try {
      console.log("[Safety Guard] Performing runtime PostgreSQL handshake...");
      await assertLiveTestDatabaseSafety(prisma);
      console.log(`[Safety Guard] Runtime Handshake: Passed (current_database() === '${target.database}')`);
      console.log("✅ Dedicated test database is ready and verified!");
    } finally {
      await prisma.$disconnect();
    }
  } catch (err: unknown) {
    console.error("❌ Verification failed:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
