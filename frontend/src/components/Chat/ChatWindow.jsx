import { useRef } from "react";
import MessageBubble from "./MessageBubble.jsx";
import TypingIndicator from "./TypingIndicator.jsx";

const SUGGESTIONS = [
  { emoji: "\u{1F4D8}", text: "Topic explanations, summaries, and structured exam support" },
  { emoji: "\u{1F4BB}", text: "Complete code generation, debugging, and single-file web projects" },
  { emoji: "\u{1F4C4}", text: "PDF summaries, note extraction, and document-grounded answers" },
  { emoji: "\u{1F5BC}\uFE0F", text: "AI image generation, screenshot understanding, and edits" },
  { emoji: "\u{1F9E0}", text: "Fast quiz generation from your uploaded materials" },
  { emoji: "\u2709\uFE0F", text: "Direct email delivery with polished PDF or Word attachments" },
];

export default function ChatWindow({
  messages,
  onSpeakMessage,
  isSpeaking,
  speakingText,
  liveTypingUsers = [],
}) {
  const showWelcome = messages.length <= 1 && messages[0]?.id === "welcome-message";
  const scrollRef = useRef(null);
  const endRef = useRef(null);

  return (
    <section className="conversation-scroll" ref={scrollRef}>
      <div className="conversation-inner">
        {showWelcome ? (
          <div className="welcome-screen">
            <div className="welcome-icon welcome-logo-badge" aria-hidden="true">
              <span className="welcome-cap">{"\u{1F393}"}</span>
            </div>
            <h2>Your all-in-one assistant for study, coding, documents, and media.</h2>
            <p>
              Upload files, create polished outputs, generate visuals, and work across
              multiple AI modes from one clean workspace.
            </p>
            <div className="suggestion-grid">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.text}
                  className="suggestion-chip"
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("edu-suggestion", { detail: suggestion.text }),
                    );
                  }}
                >
                  <span className="suggestion-emoji">{suggestion.emoji}</span>
                  <span>{suggestion.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onSpeakMessage={onSpeakMessage}
                isSpeaking={isSpeaking}
                speakingText={speakingText}
              />
            ))}
            {liveTypingUsers.length ? (
              <TypingIndicator
                label={
                  liveTypingUsers.length === 1
                    ? `${liveTypingUsers[0]} is typing...`
                    : `${liveTypingUsers.length} people are typing...`
                }
              />
            ) : null}
          </>
        )}
        <div ref={endRef} aria-hidden="true" />
      </div>
    </section>
  );
}
