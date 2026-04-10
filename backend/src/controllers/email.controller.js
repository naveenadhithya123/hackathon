import { sendEmail } from "../services/brevo.service.js";
import { chatCompletion } from "../services/huggingface.service.js";
import { buildAnswerPdf } from "../utils/pdfGenerator.js";

function escapeHtml(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeExportText(text = "") {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, (match) =>
      match
        .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
        .replace(/```/g, "")
        .trim(),
    )
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/!\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/^\s*\d+\.\s+/gm, (match) => match.trim() + " ")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildWordHtml(answer = "") {
  const normalized = normalizeExportText(answer);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block
        .split(/\r?\n/)
        .map((line) => escapeHtml(line.trim()))
        .filter(Boolean);

      if (!lines.length) {
        return "";
      }

      const isList = lines.every((line) => /^(-|\d+\.)\s/.test(line));
      if (isList) {
        const items = lines
          .map((line) => line.replace(/^(-|\d+\.)\s/, ""))
          .map((line) => `<li>${line}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }

      return `<p>${lines.join("<br />")}</p>`;
    })
    .filter(Boolean)
    .join("");

  return paragraphs || "<p>No answer was available.</p>";
}

function buildWordDocument({ title = "AI Tutor Answer", question = "", answer = "" }) {
  const body = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body style="font-family:Segoe UI, Arial, sans-serif; line-height:1.6; color:#111827;">
    <h1>${escapeHtml(title)}</h1>
    ${question ? `<p><strong>Question:</strong> ${escapeHtml(normalizeExportText(question))}</p>` : ""}
    <h2>Answer</h2>
    <div>${buildWordHtml(answer)}</div>
  </body>
</html>`;

  return Buffer.from(body, "utf8");
}

function isExportStatusMessage(content = "") {
  const normalized = String(content || "").trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return /^i have sent it to .+ in (pdf|word) format\.?$/.test(normalized) ||
    /i could not send the email right now/.test(normalized) ||
    /send me the email address, and i'll send the latest answer as an attachment/.test(normalized);
}

function extractConversationContext(messages = []) {
  let question = "";
  let answer = "";

  for (const message of messages || []) {
    const content = String(message?.content || "").trim();

    if (!content || message?.status === "pending" || isExportStatusMessage(content)) {
      continue;
    }

    if (message.role === "user") {
      question = content;
    }

    if (message.role === "assistant") {
      answer = content;
    }
  }

  return { question, answer };
}

function isMissingAnswer(value = "") {
  const normalized = String(value || "").trim();
  return !normalized || /^no previous answer was available\.?$/i.test(normalized);
}

function isGenericQuestion(value = "") {
  const normalized = String(value || "").trim();
  return !normalized || /^ai tutor answer$/i.test(normalized);
}

export async function sendAnswerEmail(req, res) {
  try {
    const {
      to,
      subject,
      answer,
      question,
      attachPdf = false,
      attachmentFormat = "pdf",
      attachments = [],
      messages = [],
    } = req.body;

    const derivedContext = extractConversationContext(messages);
    const finalAnswer = isMissingAnswer(answer) ? derivedContext.answer || "" : String(answer || "");
    const finalQuestion = isGenericQuestion(question)
      ? derivedContext.question || "AI Tutor Answer"
      : String(question || "");

    if (!to || !finalAnswer) {
      return res.status(400).json({ error: "to and answer are required." });
    }

    const safeQuestion = finalQuestion || "AI Tutor Answer";
    const generatedAttachment =
      attachmentFormat === "doc"
        ? {
            name: "ai-tutor-answer.doc",
            content: buildWordDocument({
              title: subject ?? "AI Tutor Answer",
              question: safeQuestion,
              answer: finalAnswer,
            }).toString("base64"),
            type: "application/msword",
          }
        : {
            name: "ai-tutor-answer.pdf",
            content: buildAnswerPdf({
              title: subject ?? "AI Tutor Answer",
              question: safeQuestion,
              answer: finalAnswer,
            }).toString("base64"),
            type: "application/pdf",
          };

    const emailAttachments = [
      ...(attachPdf || attachmentFormat ? [generatedAttachment] : []),
      ...attachments,
    ];

    const response = await sendEmail({
      to,
      subject: subject ?? "AI Tutor Answer",
      html: `
        <h2>AI Tutor Answer</h2>
        <p>Your requested attachment is included with this email.</p>
        ${finalQuestion ? `<p><strong>Question:</strong> ${finalQuestion}</p>` : ""}
      `,
      text: finalQuestion
        ? `Your requested attachment is included.\n\nQuestion: ${finalQuestion}`
        : "Your requested attachment is included.",
      attachments: emailAttachments,
    });

    return res.json({
      success: true,
      accepted: true,
      provider: "brevo",
      messageId: response?.messageId || response?.message_id || "",
      response,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function resolveEmailIntent(req, res) {
  try {
    const {
      message = "",
      fallbackEmail = "",
      lastEmailTarget = "",
      lastQuestion = "",
      lastAssistantAnswer = "",
      pendingEmailRequest = null,
    } = req.body || {};

    const content = String(message || "").trim();
    if (!content) {
      return res.json({ isEmailIntent: false });
    }

    const raw = await chatCompletion({
      messages: [
        {
          role: "system",
          content: `You classify whether a chat message is an email/export action follow-up.
Return valid JSON only in this exact shape:
{
  "isEmailIntent": true,
  "to": "email or empty",
  "attachmentFormat": "pdf or doc",
  "confidence": "high|medium|low",
  "reason": "short string"
}

Rules:
- If the user is correcting or providing a recipient email, set isEmailIntent true.
- If the user says send/mail/email this, send it, to this address, not that one, use this one, resend, or asks for pdf/word/doc after an earlier email action, set isEmailIntent true.
- Prefer the newly mentioned email if present.
- If no email is mentioned but the wording clearly refers to the previous email flow, use lastEmailTarget or fallbackEmail if available.
- If the user asks for word/doc/docx, set attachmentFormat to "doc". Otherwise use "pdf".
- If the message is ordinary study chat, set isEmailIntent false.
- Never explain outside JSON.`,
        },
        {
          role: "user",
          content: `Current message:
${content}

Known context:
- fallbackEmail: ${fallbackEmail || "none"}
- lastEmailTarget: ${lastEmailTarget || "none"}
- lastQuestion: ${lastQuestion || "none"}
- lastAssistantAnswer present: ${lastAssistantAnswer ? "yes" : "no"}
- pendingEmailRequest: ${pendingEmailRequest ? JSON.stringify(pendingEmailRequest) : "none"}`,
        },
      ],
      temperature: 0,
      maxTokens: 180,
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.json({ isEmailIntent: false });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return res.json({
      isEmailIntent: Boolean(parsed.isEmailIntent),
      to: String(parsed.to || "").trim(),
      attachmentFormat: parsed.attachmentFormat === "doc" ? "doc" : "pdf",
      confidence: parsed.confidence || "low",
      reason: parsed.reason || "",
    });
  } catch (_error) {
    return res.json({ isEmailIntent: false });
  }
}
