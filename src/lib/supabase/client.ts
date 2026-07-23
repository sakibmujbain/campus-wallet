import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client (auth only — we talk to Postgres directly via `pg`).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
