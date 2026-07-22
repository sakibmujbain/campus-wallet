// Runs node-pg-migrate programmatically so it works identically on Windows/macOS/Linux
// and always targets the DIRECT (5432) connection — never the transaction pooler.
import "dotenv/config";
import runner from "node-pg-migrate";

const direction = process.argv[2] === "down" ? "down" : "up";
const databaseUrl = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("✗ Set DATABASE_URL_DIRECT (or DATABASE_URL) in your .env first.");
  process.exit(1);
}

// Supabase requires SSL; a local CI Postgres does not. Detect from the URL.
const needsSsl = /sslmode=require|supabase\.com/.test(databaseUrl);

const options = {
  databaseUrl: needsSsl
    ? { connectionString: databaseUrl, ssl: { rejectUnauthorized: false } }
    : databaseUrl,
  dir: "migrations",
  direction,
  migrationsTable: "pgmigrations",
  verbose: true,
};

// When stepping down, only roll back the most recent migration by default.
if (direction === "down") options.count = 1;

try {
  await runner(options);
  console.log(`✓ Migrations ${direction} complete.`);
  process.exit(0);
} catch (err) {
  console.error(`✗ Migration ${direction} failed:`, err.message ?? err);
  process.exit(1);
}
