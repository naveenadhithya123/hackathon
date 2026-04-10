import { useEffect, useMemo, useState } from "react";
import { buildDocumentDownloadUrl } from "../../services/api.js";

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHighlightedCode(language, code) {
  const value = String(code || "");
  const normalizedLanguage = String(language || "").toLowerCase();

  if (/html|xml/.test(normalizedLanguage)) {
    return escapeHtml(value)
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-comment">$1</span>')
      .replace(/(&lt;\/?)([a-zA-Z0-9-]+)([^&]*?)(\/?&gt;)/g, (_match, open, tag, attrs, close) => {
        const formattedAttrs = attrs.replace(
          /([a-zA-Z-:]+)=(&quot;.*?&quot;|&#39;.*?&#39;)/g,
          '<span class="tok-attr">$1</span>=<span class="tok-string">$2</span>',
        );
        return `<span class="tok-tag">${open}${tag}</span>${formattedAttrs}<span class="tok-tag">${close}</span>`;
      });
  }

  if (/css/.test(normalizedLanguage)) {
    return escapeHtml(value)
      .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="tok-comment">$1</span>')
      .replace(/(".*?"|'.*?')/g, '<span class="tok-string">$1</span>')
      .replace(/\b(\d+(\.\d+)?(px|rem|em|vh|vw|%|s|ms)?|#[0-9a-fA-F]{3,8})\b/g, '<span class="tok-number">$1</span>')
      .replace(/([.#]?[a-zA-Z_-][a-zA-Z0-9_-]*)(\s*\{)/g, '<span class="tok-selector">$1</span>$2')
      .replace(/\b(color|background|display|position|padding|margin|gap|width|height|font-size|font-weight|border|border-radius|box-shadow|grid|flex|align-items|justify-content|transition|transform|overflow|max-width|min-width|max-height|min-height)\b/g, '<span class="tok-keyword">$1</span>');
  }

  return escapeHtml(value)
    .replace(/(\/\/.*$|\/\*[\s\S]*?\*\/)/gm, '<span class="tok-comment">$1</span>')
    .replace(/(".*?"|'.*?'|`[\s\S]*?`)/g, '<span class="tok-string">$1</span>')
    .replace(/\b(\d+(\.\d+)?)\b/g, '<span class="tok-number">$1</span>')
    .replace(/\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|class|extends|async|await|try|catch|finally|import|from|export|default|true|false|null|undefined)\b/g, '<span class="tok-keyword">$1</span>')
    .replace(/\b(document|window|console|Array|Object|String|Number|Math|JSON|fetch|setTimeout|setInterval|addEventListener|querySelector|getElementById)\b/g, '<span class="tok-builtins">$1</span>')
    .replace(/([{}()[\]])/g, '<span class="tok-bracket">$1</span>');
}

function normalizeRichText(value = "") {
  return String(value)
    .replace(/\\+\(/g, "(")
    .replace(/\\+\)/g, ")")
    .replace(/\\+\[/g, "[")
    .replace(/\\+\]/g, "]")
    .replace(/\\mathbb\{N\}/g, "ℕ")
    .replace(/\\mathbb\{Z\}/g, "ℤ")
    .replace(/\\mathbb\{Q\}/g, "ℚ")
    .replace(/\\mathbb\{R\}/g, "ℝ")
    .replace(/\\mathbb\{C\}/g, "ℂ")
    .replace(/\\notin/g, "∉")
    .replace(/\\in/g, "∈")
    .replace(/\\subseteq/g, "⊆")
    .replace(/\\subset/g, "⊂")
    .replace(/\\supseteq/g, "⊇")
    .replace(/\\supset/g, "⊃")
    .replace(/\\cup/g, "∪")
    .replace(/\\cap/g, "∩")
    .replace(/\\mid/g, "|")
    .replace(/\\to/g, "→")
    .replace(/\\times/g, "×")
    .replace(/\\neq/g, "≠")
    .replace(/\\geq/g, "≥")
    .replace(/\\leq/g, "≤")
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\{([^{}]+)\}/g, "$1");
}

function CodeBlock({ language, code }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (_error) {
      setCopied(false);
    }
  }

  return (
    <div className="code-block-shell">
      <div className="code-block-topbar">
        <div className="code-block-label">{language || "code"}</div>
        <button className="code-copy-button" type="button" onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="code-block">
        <code dangerouslySetInnerHTML={{ __html: renderHighlightedCode(language, code) }} />
      </pre>
    </div>
  );
}

function cleanupEscapedMath(value = "") {
  return String(value)
    .replace(/\\+/g, "\\")
    .replace(/\\(dots|ldots)/g, "...")
    .replace(/\\text\{([^}]*)\}/g, "$1");
}

function renderInline(text) {
  const normalizedText = cleanupEscapedMath(normalizeRichText(text));
  const parts = normalizedText
    .split(/(\[[^\]]+\]\([^)]+\)|\*\*.*?\*\*|\*[^*\n]+\*|`.*?`)/g)
    .filter(Boolean);

  return parts.map((part, index) => {
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);

    if (linkMatch) {
      const [, label, rawHref] = linkMatch;
      const href = rawHref.trim();
      const isWebUrl = /^(https?:)?\/\//i.test(href);

      if (isWebUrl) {
        return (
          <a key={index} href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        );
      }

      return <span key={index}>{label}</span>;
    }

    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }

    return <span key={index}>{part}</span>;
  });
}

function renderRichContent(content) {
  const segments = String(content || "").split("```");

  if (segments.length > 1) {
    return segments.map((segment, segmentIndex) => {
      if (segmentIndex % 2 === 1) {
        const [firstLine, ...rest] = segment.split("\n");
        const language = firstLine.trim();
        const code = rest.join("\n").trimEnd();

        return <CodeBlock key={`code-${segmentIndex}`} language={language} code={code} />;
      }

      return <div key={`text-${segmentIndex}`}>{renderTextBlocks(segment)}</div>;
    });
  }

  return renderTextBlocks(content);
}

function renderTextBlocks(content) {
  const lines = String(content || "").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      const level = trimmed.match(/^#+/)[0].length;
      const text = trimmed.replace(/^#{1,3}\s+/, "");
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      blocks.push(<Tag key={`heading-${index}`}>{renderInline(text)}</Tag>);
      index += 1;
      continue;
    }

    if (/^[-*\u2022]\s+/.test(trimmed)) {
      const items = [];
      while (index < lines.length && /^[-*\u2022]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*\u2022]\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim()) {
      paragraph.push(lines[index].trim());
      index += 1;
    }

    blocks.push(<p key={`p-${index}`}>{renderInline(paragraph.join(" "))}</p>);
  }

  return blocks;
}

export default function MessageBubble({ message, onSpeakMessage, isSpeaking, speakingText }) {
  const normalizedContent = useMemo(
    () =>
      (
        message.role === "assistant"
          ? cleanupEscapedMath(normalizeRichText(message.content || ""))
          : message.content || ""
      ),
    [message.content, message.role],
  );
  const [displayedContent, setDisplayedContent] = useState(normalizedContent);
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const isPending = message.status === "pending";
  const attachments = message.attachments || [];
  const visibleAttachments = attachments.filter(
    (attachment) => attachment?.type !== "image" && attachment?.fileUrl,
  );
  const sources = message.sources || [];
  const hasImage = Boolean(message.imageUrl);
  const hasFile = Boolean(message.fileUrl) && visibleAttachments.length === 0;
  const downloadUrl = message.imageUrl;
  const fileDownloadUrl = buildDocumentDownloadUrl(
    message.fileUrl,
    message.fileName || "generated-file",
  );
  const canReadAloud =
    !isUser &&
    displayedContent &&
    !message.imageUrl &&
    !isPending &&
    message.messageType !== "image_generation";
  const isCurrentSpeech = canReadAloud && isSpeaking && speakingText === displayedContent.trim();
  const shouldAnimate =
    !isUser &&
    !hasImage &&
    !isPending &&
    message.animate &&
    typeof message.content === "string" &&
    message.content.length > 0;

  useEffect(() => {
    if (!shouldAnimate) {
      setDisplayedContent(normalizedContent);
      return undefined;
    }

    setDisplayedContent("");
    let index = 0;
    const source = normalizedContent;
    const timer = window.setInterval(() => {
      index = Math.min(source.length, index + Math.max(4, Math.ceil(source.length / 70)));
      setDisplayedContent(source.slice(0, index));
      if (index >= source.length) {
        window.clearInterval(timer);
      }
    }, 18);

    return () => window.clearInterval(timer);
  }, [normalizedContent, shouldAnimate]);

  async function handleCopyMessage() {
    try {
      await navigator.clipboard.writeText(displayedContent || message.content || "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (_error) {
      setCopied(false);
    }
  }

  function handleDownload(url) {
    if (!url) {
      return;
    }

    const link = document.createElement("a");
    link.href = url;
    link.rel = "noreferrer";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  const renderedBody = useMemo(
    () => (isUser ? displayedContent : renderRichContent(displayedContent)),
    [displayedContent, isUser],
  );

  return (
    <article className={`message-row ${isUser ? "user" : "assistant"} ${isUser ? "is-copyable" : ""}`}>
      <div
        className={`message-card ${isUser ? "user" : "assistant"} ${isPending ? "pending" : ""} ${
          hasImage ? "has-image" : "text-only"
        }`}
      >
        {isUser && message.authorLabel ? (
          <div className="message-author">{message.authorLabel}</div>
        ) : null}

        {isUser && displayedContent ? (
          <button className="message-copy-fab" type="button" onClick={handleCopyMessage}>
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}

        {displayedContent ? (
          <div className="message-body">
            {renderedBody}
            {shouldAnimate && displayedContent.length < normalizedContent.length ? (
              <span className="typing-cursor" aria-hidden="true" />
            ) : null}
          </div>
        ) : null}

        {message.imageUrl ? (
          <div className="inline-image-card">
            <img src={message.imageUrl} alt="Attachment" />
            <div className="image-status">
              <span>{isPending ? "Processing..." : "Ready"}</span>
              {!isPending ? (
                <button
                  className="image-download-link"
                  type="button"
                  onClick={() => handleDownload(downloadUrl)}
                >
                  Download
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {hasFile ? (
          <div className="inline-file-card">
            <div className="inline-file-meta">
              <strong>{message.fileName || "generated-file"}</strong>
              <span>{isPending ? "Preparing file..." : "File ready"}</span>
            </div>
            {!isPending ? (
              <button
                className="image-download-link"
                type="button"
                onClick={() => handleDownload(fileDownloadUrl)}
              >
                Download
              </button>
            ) : null}
          </div>
        ) : null}

        {visibleAttachments.length ? (
          <div className="inline-attachments-list">
            {visibleAttachments.map((attachment) => (
              <div className="inline-file-card attachment-inline-card" key={attachment.id || attachment.fileUrl || attachment.name}>
                <div className="inline-file-meta">
                  <strong>{attachment.name || "attachment"}</strong>
                  <span>{attachment.type === "document" ? "PDF attached" : "Attachment ready"}</span>
                </div>
                {attachment.fileUrl ? (
                  <button
                    className="image-download-link"
                    type="button"
                    onClick={() =>
                      handleDownload(
                        buildDocumentDownloadUrl(attachment.fileUrl, attachment.name || "attachment"),
                      )
                    }
                  >
                    Download
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {sources.length ? (
          <div className="message-sources">
            {sources.map((source) => (
              <span key={`${source.documentId || source.title}-${source.title}`}>
                {source.title}
              </span>
            ))}
          </div>
        ) : null}

        {canReadAloud ? (
          <div className="message-actions">
            <button className="mini-read-button" onClick={() => onSpeakMessage?.(displayedContent)}>
              {isCurrentSpeech ? "Stop reading" : "Read aloud"}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
