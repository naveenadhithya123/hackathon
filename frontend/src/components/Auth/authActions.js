import { supabase } from "../../services/supabase.js";

export function getAuthRedirectTo() {
  return import.meta.env.VITE_AUTH_REDIRECT_URL ||
    (typeof window !== "undefined" ? window.location.origin : undefined);
}

export async function startGoogleAuth() {
  if (!supabase) {
    throw new Error("Supabase auth is not configured yet.");
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: getAuthRedirectTo(),
      queryParams: {
        access_type: "offline",
        prompt: "select_account",
      },
    },
  });

  if (error) {
    throw error;
  }
}
