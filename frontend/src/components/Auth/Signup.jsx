import { useState } from "react";
import { supabase } from "../../services/supabase.js";
import GoogleAuthButton from "./GoogleAuthButton.jsx";
import { getAuthRedirectTo, startGoogleAuth } from "./authActions.js";

export default function Signup({ onSwitch }) {
  const [fullName, setFullName] = useState("");
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
    const emailRedirectTo = getAuthRedirectTo();
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
        <span>or sign up with email</span>
      </div>
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
      <button className="send-button auth-primary-action" type="submit" disabled={loading || googleLoading}>
        {loading ? "Creating account..." : "Create Account"}
      </button>
      {status && <p className="status-row" style={{ color: status.includes("Account created") ? "var(--success)" : "var(--danger)" }}>{status}</p>}
      <p className="auth-switch-copy">
        Already have an account?{" "}
        <button className="pill-button" type="button" onClick={onSwitch} style={{ padding: "4px 10px", fontSize: "0.88rem" }}>
          Sign in
        </button>
      </p>
    </form>
  );
}
