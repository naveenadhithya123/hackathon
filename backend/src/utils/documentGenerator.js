import { buildAnswerPdf } from "./pdfGenerator.js";

function sanitizeFilenamePart(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "document";
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugFromDate() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
}

function buildShortFilename(format = "pdf", prompt = "") {
  const normalized = String(prompt).toLowerCase();
  let prefix = "study-file";

  if (/\b(note|notes|summary|summar(y|ise|ize)|handout)\b/.test(normalized)) {
    prefix = "study-note";
  } else if (/\b(resume|cv)\b/.test(normalized)) {
    prefix = "resume";
  } else if (/\b(letter)\b/.test(normalized)) {
    prefix = "letter";
  } else if (/\b(worksheet|quiz)\b/.test(normalized)) {
    prefix = "worksheet";
  }

  return `${prefix}-${slugFromDate()}.${format}`;
}

function extractLiteralFileContent(prompt = "", fallback = "") {
  const text = String(prompt);

  const quotedMatch =
    text.match(/(?:only|just)\s+(?:the\s+)?word\s+["“']([^"”']+)["”']/i) ||
    text.match(/contains?\s+(?:only\s+)?(?:the\s+)?word\s+["“']([^"”']+)["”']/i) ||
    text.match(/with\s+only\s+(?:the\s+)?word\s+["“']([^"”']+)["”']/i) ||
    text.match(/contains?\s+["“']([^"”']+)["”']\s+(?:alone|only)/i);

  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const plainWordMatch =
    text.match(/(?:only|just)\s+(?:the\s+)?word\s+([a-z0-9_-]+)/i) ||
    text.match(/contains?\s+(?:only\s+)?(?:the\s+)?word\s+([a-z0-9_-]+)/i) ||
    text.match(/with\s+only\s+(?:the\s+)?word\s+([a-z0-9_-]+)/i) ||
    text.match(/contains?\s+([a-z0-9_-]+)\s+(?:alone|only)/i);

  if (plainWordMatch?.[1]) {
    return plainWordMatch[1].trim();
  }

  return String(fallback || "").trim();
}

export function hasLiteralContentRequest(prompt = "") {
  const text = String(prompt || "");
  return /(?:only|just)\s+(?:the\s+)?word\b/i.test(text) ||
    /contains?\s+(?:only\s+)?(?:the\s+)?word\b/i.test(text) ||
    /with\s+only\s+(?:the\s+)?word\b/i.test(text) ||
    /contains?\s+["â€œ'][^"â€']+["â€']\s+(?:alone|only)/i.test(text);
}

function htmlToWordDocument(title, content) {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  const formatInline = (text = "") =>
    escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, "<code>$1</code>");

  while (index < lines.length) {
    const trimmed = lines[index].trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      const level = Math.min(trimmed.match(/^#+/)[0].length, 3);
      const text = trimmed.replace(/^#{1,3}\s+/, "");
      const tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      blocks.push(`<${tag}>${formatInline(text)}</${tag}>`);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];

      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }

      blocks.push(`<ul>${items.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];

      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }

      blocks.push(`<ol>${items.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim()) {
      paragraph.push(lines[index].trim());
      index += 1;
    }

    blocks.push(`<p>${formatInline(paragraph.join(" "))}</p>`);
  }

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: "Segoe UI", Arial, sans-serif; line-height: 1.6; color: #1f2937; margin: 28px; }
      h1, h2, h3 { color: #0f172a; margin: 18px 0 10px; }
      h1 { font-size: 22px; }
      h2 { font-size: 18px; }
      h3 { font-size: 15px; }
      p { margin: 0 0 12px; }
      ul, ol { margin: 0 0 14px 22px; }
      li { margin: 0 0 6px; }
      code { font-family: Consolas, "Courier New", monospace; background: #f3f4f6; padding: 1px 4px; }
      strong { font-weight: 700; }
    </style>
  </head>
  <body>
    ${blocks.join("\n") || `<p>${formatInline(content)}</p>`}
  </body>
</html>`;
}

export function inferDocumentFormat(prompt = "") {
  const normalized = String(prompt).toLowerCase();

  if (/\bpdf\b/.test(normalized)) {
    return "pdf";
  }

  if (/\b(word|docx?|dox|ms word)\b/.test(normalized)) {
    return "doc";
  }

  if (/\btxt|text file|plain text\b/.test(normalized)) {
    return "txt";
  }

  return "pdf";
}

export function buildGeneratedDocument({ prompt, content }) {
  const format = inferDocumentFormat(prompt);
  const finalContent = extractLiteralFileContent(prompt, content) || "Generated study file";
  const title = prompt || "Generated study file";
  const filename = buildShortFilename(format, prompt);

  if (format === "txt") {
    return {
      buffer: Buffer.from(finalContent, "utf8"),
      filename,
      mimeType: "text/plain",
    };
  }

  if (format === "doc") {
    return {
      buffer: Buffer.from(htmlToWordDocument(title, finalContent), "utf8"),
      filename,
      mimeType: "application/msword",
    };
  }

  return {
    buffer: buildAnswerPdf({
      title: hasLiteralContentRequest(prompt) ? "" : title,
      question: "",
      answer: finalContent,
    }),
    filename,
    mimeType: "application/pdf",
  };
}
