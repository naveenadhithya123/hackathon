import { chatCompletion } from "../services/huggingface.service.js";

function normalize(text = "") {
  return String(text || "").trim();
}

function compact(text = "", maxLength = 220) {
  const value = normalize(text).replace(/\s+/g, " ");
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function looksLikeFollowUp(message = "") {
  const normalized = normalize(message).toLowerCase();

  if (!normalized) {
    return false;
  }

  return normalized.length <= 120 ||
    /\b(this|that|it|those|these|same|again|continue|more|above|before|previous|earlier|here|there|word|pdf|mail|email|send)\b/.test(
      normalized,
    );
}

export async function resolveConversationMessage({ message = "", history = [], mode = "study" }) {
  const userMessage = normalize(message);

  if (!userMessage) {
    return {
      normalizedMessage: "",
      confidence: "low",
      usedHistory: false,
    };
  }

  if (!looksLikeFollowUp(userMessage)) {
    return {
      normalizedMessage: userMessage,
      confidence: "high",
      usedHistory: false,
    };
  }

  const recentHistory = history
    .filter((item) => item?.role && item?.content)
    .slice(-8)
    .map((item) => `${item.role}: ${compact(item.content)}`)
    .join("\n");

  try {
    const raw = await chatCompletion({
      messages: [
        {
          role: "system",
          content: `You rewrite short user follow-ups into a clearer final user request.
Return valid JSON only in this exact shape:
{
  "normalizedMessage": "string",
  "confidence": "high|medium|low",
  "usedHistory": true
}

Rules:
- Fix obvious spelling mistakes and casual typing mistakes.
- Preserve the original meaning.
- If the user refers to previous chat context, rewrite the request so the reference is explicit.
- If the message is already clear, keep it nearly the same.
- Do not invent facts that are not present in the current message or recent history.
- Keep the output in the same language as the user input.
- This is for mode: ${mode}.`,
        },
        {
          role: "user",
          content: `Recent chat:\n${recentHistory || "No recent history"}\n\nCurrent user message:\n${userMessage}`,
        },
      ],
      temperature: 0,
      maxTokens: 180,
    });

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("No JSON returned");
    }

    const parsed = JSON.parse(match[0]);
    return {
      normalizedMessage: normalize(parsed.normalizedMessage) || userMessage,
      confidence: parsed.confidence || "low",
      usedHistory: Boolean(parsed.usedHistory),
    };
  } catch (_error) {
    return {
      normalizedMessage: userMessage,
      confidence: "low",
      usedHistory: false,
    };
  }
}
