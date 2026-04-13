export default function GoogleAuthButton({ onClick, disabled = false, label = "Continue with Google" }) {
  return (
    <button
      className="google-auth-button"
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="google-auth-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img" focusable="false">
          <path
            fill="#EA4335"
            d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.8-6-6.2s2.7-6.2 6-6.2c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 2.9 14.7 2 12 2 6.9 2 2.8 6.5 2.8 12s4.1 10 9.2 10c5.3 0 8.8-3.8 8.8-9.1 0-.6-.1-1.1-.1-1.5H12Z"
          />
          <path
            fill="#34A853"
            d="M3.9 7.3 7 9.6c.8-1.7 2.3-3 5-3 1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 2.9 14.7 2 12 2 8.5 2 5.4 4 3.9 7.3Z"
          />
          <path
            fill="#FBBC05"
            d="M12 22c2.6 0 4.8-.9 6.4-2.4l-3-2.5c-.8.6-1.9 1-3.4 1-3.9 0-5.2-2.6-5.5-3.8L3.3 17c1.5 3 4.7 5 8.7 5Z"
          />
          <path
            fill="#4285F4"
            d="M3.3 17 6.5 14.3c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2L3.3 7.6C2.7 8.9 2.3 10.4 2.3 12s.4 3.1 1 4.4Z"
          />
        </svg>
      </span>
      <span>{label}</span>
    </button>
  );
}
