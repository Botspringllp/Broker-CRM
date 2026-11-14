import dotenv from "dotenv";
dotenv.config();

import { validateTestDatabaseUrl } from "./db-guard";

// Validate TEST_DATABASE_URL with fail-closed safety guard
const { url: testDbUrl } = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);

// Redirect DATABASE_URL to TEST_DATABASE_URL so any DAL module importing @/server/db
// is strictly guaranteed to operate on broker_crm_test
process.env.DATABASE_URL = testDbUrl;
