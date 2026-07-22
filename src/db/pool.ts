import { Pool } from "pg";

// Module-scoped singleton Pool. On Vercel serverless, a per-request Pool would
// exhaust Postgres' ~60-connection cap, so we reuse one small pool per lambda
// instance and connect through Supabase's TRANSACTION-mode pooler (port 6543).
//
// Important for the transaction pooler: keep every unit of work inside one
// explicit transaction and never rely on session state across statements
// (that is what `tx.ts` does). We also avoid *named* prepared statements —
// plain parameterized `pool.query(text, values)` sends unnamed statements,
// which the transaction pooler handles correctly.

const globalForPg = globalThis as unknown as { __pgPool?: Pool };

const connectionString = process.env.DATABASE_URL;
const needsSsl = /sslmode=require|supabase\.com/.test(connectionString ?? "");

// TLS posture. By default we encrypt but don't verify the chain, because
// Supabase's pooler cert commonly fails strict verification — the pragmatic,
// widely-used setting for that host. For a hardened deploy, set PG_SSL_STRICT=true
// and (if needed) provide the pooler CA via PG_CA_CERT to get full MITM protection.
const sslConfig = needsSsl
  ? process.env.PG_SSL_STRICT === "true"
    ? { rejectUnauthorized: true, ca: process.env.PG_CA_CERT }
    : { rejectUnauthorized: false }
  : undefined;

export const pool =
  globalForPg.__pgPool ??
  new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslConfig,
  });

if (process.env.NODE_ENV !== "production") globalForPg.__pgPool = pool;
