import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main style={{ maxWidth: "26rem" }}>
      <div className="eyebrow">Campus Wallet</div>
      <h1>Student sign-in</h1>
      <p className="sub">
        Verify your identity with your official university <code>.edu.bd</code> email to unlock zero-fee campus
        payments, savings, and rewards.
      </p>
      <div className="card">
        <LoginForm />
      </div>
    </main>
  );
}
