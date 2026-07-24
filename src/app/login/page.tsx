import { LoginForm } from "./login-form";
import { CoinDoodle, DoodleScatter } from "@/components/doodle";

export default function LoginPage() {
  return (
    <main style={{ maxWidth: "44rem", position: "relative", minHeight: "82vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <DoodleScatter />
      <div className="main-narrow" style={{ position: "relative", zIndex: 1, width: "100%", margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.5rem" }}>
          <CoinDoodle style={{ width: "2.5rem", height: "2.5rem" }} />
          <span className="eyebrow" style={{ margin: 0 }}>Campus Wallet</span>
        </div>
        <h1 style={{ fontSize: "2.1rem", lineHeight: 1.1 }}>Your campus, <span className="hl">one wallet</span>.</h1>
        <p className="sub" style={{ marginTop: "0.5rem" }}>
          Sign in with your university <code>.edu.bd</code> email to unlock zero-fee campus payments, round-up savings, and rewards.
        </p>
        <div className="card">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
