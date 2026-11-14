import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { assertLiveTestDatabaseSafety, validateTestDatabaseUrl } from "../setup/db-guard";

let testPrismaInstance: PrismaClient | null = null;
let isGuardVerified = false;

/**
 * Returns a live PrismaClient strictly connected to the isolated test database (broker_crm_test).
 * Guarantees that the runtime safety guard executes before any query runs.
 */
export async function getTestPrisma(): Promise<PrismaClient> {
  if (testPrismaInstance && isGuardVerified) {
    return testPrismaInstance;
  }

  const { url: testDbUrl } = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);

  testPrismaInstance = new PrismaClient({
    datasources: {
      db: { url: testDbUrl },
    },
    log: ["error"],
  });

  // Execute runtime safety handshake to assert current_database() === 'broker_crm_test'
  await assertLiveTestDatabaseSafety(testPrismaInstance);
  isGuardVerified = true;

  return testPrismaInstance;
}

/**
 * Disconnects the test database Prisma client.
 */
export async function disconnectTestDb(): Promise<void> {
  if (testPrismaInstance) {
    await testPrismaInstance.$disconnect();
    testPrismaInstance = null;
    isGuardVerified = false;
  }
}

