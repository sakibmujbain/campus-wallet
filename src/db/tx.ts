import type { PoolClient } from "pg";
import { pool } from "./pool";

type Isolation = "read committed" | "serializable";

interface TxOptions {
  /** Sets `app.current_user_id` for the transaction — the GUC that RLS and the
   *  audit trigger read (added in the Phase-1 migration). Uses SET LOCAL so the
   *  identity can never leak across pooled connections. */
  userId?: number;
  /** SERIALIZABLE runs are retried on serialization/deadlock failures. */
  isolation?: Isolation;
  /** Max attempts under SERIALIZABLE (default 5). */
  maxAttempts?: number;
}

/**
 * Runs `fn` inside a single database transaction. This is the boundary the
 * "thin app, smart database" design relies on: one round trip, self-contained,
 * pooler-safe. Retries transient serialization/deadlock errors (SQLSTATE 40001 /
 * 40P01) — the demonstrable concurrency-safety story for the report.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  const isSerializable = opts.isolation === "serializable";
  const maxAttempts = isSerializable ? opts.maxAttempts ?? 5 : 1;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (isSerializable) {
        await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      }
      if (opts.userId != null) {
        // SET LOCAL semantics via set_config(..., is_local => true).
        await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(opts.userId)]);
      }
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      lastErr = err;
      const code = (err as { code?: string }).code;
      if ((code === "40001" || code === "40P01") && attempt < maxAttempts) {
        continue; // transient — retry
      }
      throw err;
    } finally {
      client.release();
    }
  }
  throw lastErr;
}
