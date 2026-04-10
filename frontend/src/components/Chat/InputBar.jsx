export default function InputBar({
  value,
  onChange,
  onSend,
  onPaste,
  disabled,
  isRecording,
  audioLevel,
  transcript,
  uploadState,
  attachments,
  onRemoveAttachment,
  onOpenFilePicker,
  onMic,
  isBusy,
  hasUploadingAttachments = false,
  placeholder = "Message ABC Assistant",
}) {
  const micLabel = isRecording ? "Stop recording" : "Start voice input";

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  }

  return (
    <div className="composer-shell">
      {attachments.length ? (
        <div className="attachment-row">
          {attachments.map((item) => (
            <div className="attachment-chip" key={item.id}>
              <div className="attachment-meta">
                <strong>{item.name}</strong>
                <span>{item.error || item.note || item.status}</span>
              </div>
              {item.previewUrl ? (
                <img src={item.previewUrl} alt={item.name} className="attachment-preview" />
              ) : null}
              <button className="chip-close" onClick={() => onRemoveAttachment(item.id)}>
                x
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="composer-card">
        <button className="round-button" type="button" onClick={onOpenFilePicker} disabled={isBusy}>
          +
        </button>

        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          disabled={disabled}
        />

        <div className="composer-tools">
          <button
            className={`round-button ${isRecording ? "recording" : ""}`}
            type="button"
            onClick={onMic}
            disabled={isBusy && !isRecording}
            aria-label={micLabel}
            title={micLabel}
          >
            {isRecording ? (
              <svg viewBox="0 0 24 24" className="toolbar-icon" aria-hidden="true">
                <rect x="7" y="7" width="10" height="10" rx="2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="toolbar-icon" aria-hidden="true">
                <path d="M12 15a4 4 0 0 0 4-4V7a4 4 0 1 0-8 0v4a4 4 0 0 0 4 4Z" />
                <path d="M19 11a7 7 0 0 1-14 0" />
                <path d="M12 18v3" />
                <path d="M9 21h6" />
              </svg>
            )}
          </button>
          {isRecording ? (
            <div className="wave-bars" aria-label="Recording level">
              {[0, 1, 2, 3, 4].map((index) => (
                <span
                  key={index}
                  style={{
                    height: `${18 + Math.max(8, audioLevel * 42 - index * 3)}px`,
                  }}
                />
              ))}
            </div>
          ) : null}
          <button
            className="send-button compact"
            type="button"
            onClick={onSend}
            disabled={disabled || isBusy || hasUploadingAttachments}
            aria-label={isBusy || hasUploadingAttachments ? "Please wait" : "Send message"}
          >
            {isBusy || hasUploadingAttachments ? (
              "..."
            ) : (
              <svg viewBox="0 0 24 24" className="toolbar-icon send-icon" aria-hidden="true">
                <path d="M5 12h13" />
                <path d="m13 6 6 6-6 6" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
