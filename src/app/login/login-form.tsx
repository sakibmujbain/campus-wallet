"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!email.toLowerCase().endsWith(".edu.bd")) {
      setMsg({ ok: false, text: "Please use your university .edu.bd email address." });
      return;
    }
    setBusy(true);
    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        if (!data.session) {
          setMsg({
            ok: true,
            text: "Account created. If you're not redirected, email confirmation is on — disable it in Supabase (or check your inbox).",
          });
          setBusy(false);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="tabs">
        <button type="button" className={mode === "signin" ? "tab active" : "tab"} onClick={() => setMode("signin")}>
          Sign in
        </button>
        <button type="button" className={mode === "signup" ? "tab active" : "tab"} onClick={() => setMode("signup")}>
          Create account
        </button>
      </div>

      {mode === "signup" && (
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ayesha Rahman" required />
        </label>
      )}
      <label>
        University email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@student.university.edu.bd"
          required
        />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
      <p className="foot" style={{ marginTop: "0.4rem" }}>
        Only <code>.edu.bd</code> university emails can register — that's your e-KYC verification.
      </p>
    </form>
  );
}
