// Runs a raw .sql file against the DIRECT connection (for seeds / ad-hoc DDL).
// Usage: node scripts/run-sql.mjs db/seed.sql
import "dotenv/config";
import { readFileSync } from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/run-sql.mjs <path/to/file.sql>");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✗ Set DATABASE_URL_DIRECT (or DATABASE_URL) in your .env first.");
  process.exit(1);
}

const needsSsl = /sslmode=require|supabase\.com/.test(connectionString);
const client = new pg.Client({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

const sql = readFileSync(file, "utf8");

try {
  await client.connect();
  await client.query(sql);
  console.log(`✓ Ran ${file}`);
} catch (err) {
  console.error(`✗ Failed running ${file}:`, err.message ?? err);
  process.exitCode = 1;
} finally {
  await client.end();
}
