// Runs the pgTyped CLI with .env loaded, so the ${PGHOST}/${PGUSER}/... placeholders
// in pgtyped.config.json resolve from process.env. Forwards any extra args (e.g. -w).
// Usage: node scripts/pgtyped.mjs        (one-shot)
//        node scripts/pgtyped.mjs -w      (watch)
import "dotenv/config";
import { spawnSync } from "node:child_process";

const args = ["-c", "pgtyped.config.json", ...process.argv.slice(2)];
const result = spawnSync("pgtyped", args, { stdio: "inherit", shell: true });
process.exit(result.status ?? 1);
