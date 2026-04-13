import { useState } from "react";
import { supabase } from "../../services/supabase.js";
import GoogleAuthButton from "./GoogleAuthButton.jsx";
import { startGoogleAuth } from "./authActions.js";

export default function Login({ onSwitch }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!supabase) { setStatus("Supabase auth is not configured yet."); return; }
    setLoading(true);
    setStatus("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setStatus(error.message);
  }

  async function handleGoogleSignIn() {
    setStatus("");
    setGoogleLoading(true);

    try {
      await startGoogleAuth();
    } catch (error) {
      setStatus(error.message || "Google sign-in could not start right now.");
      setGoogleLoading(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <GoogleAuthButton
        onClick={handleGoogleSignIn}
        disabled={loading || googleLoading}
        label={googleLoading ? "Redirecting to Google..." : "Continue with Google"}
      />
      <div className="auth-divider" aria-hidden="true">
        <span>or continue with email</span>
      </div>
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
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="current-password"
      />
      <button className="send-button auth-primary-action" type="submit" disabled={loading || googleLoading}>
        {loading ? "Signing in..." : "Sign In"}
      </button>
      {status && <p className="status-row" style={{ color: status.includes("success") ? "var(--success)" : "var(--danger)" }}>{status}</p>}
      <p className="auth-switch-copy">
        Don't have an account?{" "}
        <button className="pill-button" type="button" onClick={onSwitch} style={{ padding: "4px 10px", fontSize: "0.88rem" }}>
          Create account
        </button>
      </p>
    </form>
  );
}
