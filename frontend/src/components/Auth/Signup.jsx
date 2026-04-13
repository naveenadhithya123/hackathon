import { useState } from "react";
import { supabase } from "../../services/supabase.js";

export default function Signup({ onSwitch }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!supabase) { setStatus("Supabase auth is not configured yet."); return; }
    setLoading(true);
    setStatus("");
    const emailRedirectTo =
      import.meta.env.VITE_AUTH_REDIRECT_URL ||
      (typeof window !== "undefined" ? window.location.origin : undefined);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo,
      },
    });
    setLoading(false);
    if (error) setStatus(error.message);
    else setStatus("Account created. Confirm your email to continue.");
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Full name"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        autoComplete="name"
      />
      <input
        type="email"
        placeholder="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
      />
      <input
        type="password"
        placeholder="Password (min 6 characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={6}
        autoComplete="new-password"
      />
      <button className="send-button" type="submit" disabled={loading} style={{ width: "100%", marginBottom: "12px" }}>
        {loading ? "Creating account..." : "Create Account"}
      </button>
      {status && <p className="status-row" style={{ color: status.includes("Account created") ? "var(--success)" : "var(--danger)" }}>{status}</p>}
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "12px 0 0", textAlign: "center" }}>
        Already have an account?{" "}
        <button className="pill-button" type="button" onClick={onSwitch} style={{ padding: "4px 10px", fontSize: "0.88rem" }}>
          Sign in
        </button>
      </p>
    </form>
  );
}
