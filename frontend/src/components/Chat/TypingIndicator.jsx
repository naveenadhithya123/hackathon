export default function TypingIndicator({ label = "Someone is typing..." }) {
  return (
    <div className="typing-wrapper" aria-live="polite">
      <div className="typing-label">{label}</div>
      <div className="typing" aria-label={label}>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
