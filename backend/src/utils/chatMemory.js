function normalize(text = "") {
  return String(text || "").trim();
}

function compact(text = "", maxLength = 320) {
  const value = normalize(text).replace(/\s+/g, " ");
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function extractEmail(text = "") {
  return String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
}

function isFollowUpPrompt(message = "") {
  const normalized = normalize(message).toLowerCase();

  if (!normalized) {
    return false;
  }

  return /\b(this|that|those|it|same|again|previous|earlier|continue|more|elaborate|send|mail|email|word|pdf|explain more|about that)\b/.test(
    normalized,
  );
}

function scoreMessage(message, query) {
  const content = normalize(message?.content).toLowerCase();
  const tokens = normalize(query)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);

  let score = 0;

  for (const token of tokens) {
    if (content.includes(token)) {
      score += token.length > 5 ? 3 : 2;
    }
  }

  if (isFollowUpPrompt(query) && message?.role === "assistant") {
    score += 4;
  }

  return score;
}

function collectAttachments(history = []) {
  return history.flatMap((item) => item?.attachments || []).filter(Boolean);
}

function summarizePreviousMessages(history = [], userMessage = "") {
  const candidates = history
    .filter((item) => item?.role && item?.content)
    .map((item, index) => ({
      ...item,
      _index: index,
      _score: scoreMessage(item, userMessage),
    }))
    .sort((left, right) => right._score - left._score || right._index - left._index)
    .slice(0, isFollowUpPrompt(userMessage) ? 4 : 2)
    .filter((item) => item._score > 0 || item.role === "assistant");

  return candidates.map((item) => `${item.role}: ${compact(item.content, 220)}`);
}

export function buildChatMemory({
  history = [],
  userMessage = "",
  documentIds = [],
  attachments = [],
  mode = "study",
}) {
  const safeHistory = history.filter((item) => item?.role).slice(-16);
  const lastUserMessage = [...safeHistory].reverse().find((item) => item.role === "user" && normalize(item.content));
  const lastAssistantMessage = [...safeHistory]
    .reverse()
    .find((item) => item.role === "assistant" && normalize(item.content));
  const allAttachments = [...collectAttachments(safeHistory), ...attachments].filter(Boolean);
  const latestDocument = [...allAttachments].reverse().find((item) => item.type === "document");
  const latestImage = [...safeHistory].reverse().find((item) => item.imageUrl);
  const lastEmailTarget = [...safeHistory]
    .reverse()
    .map((item) => extractEmail(item.content))
    .find(Boolean);
  const recentRelevantMessages = summarizePreviousMessages(safeHistory, userMessage);
  const activeIntent =
    /\b(send|mail|email)\b/i.test(userMessage)
      ? "email"
      : /\b(word|doc|docx|pdf)\b/i.test(userMessage)
        ? "export"
        : /\b(explain|summary|summarize|more|continue)\b/i.test(userMessage)
          ? "explanation"
          : "chat";

  const lines = [
    `Mode: ${mode}`,
    lastUserMessage ? `Previous user request: ${compact(lastUserMessage.content, 220)}` : "",
    lastAssistantMessage ? `Previous assistant reply: ${compact(lastAssistantMessage.content, 260)}` : "",
    latestDocument ? `Latest attached document: ${latestDocument.name || "document"}${documentIds.length ? ` (${documentIds.length} active document references)` : ""}` : "",
    latestImage ? "Latest chat includes an uploaded image." : "",
    lastEmailTarget ? `Last email target in this chat: ${lastEmailTarget}` : "",
    `Detected follow-up intent: ${activeIntent}`,
    recentRelevantMessages.length
      ? `Relevant previous chat snippets:\n${recentRelevantMessages.map((item) => `- ${item}`).join("\n")}`
      : "",
  ].filter(Boolean);

  return {
    isFollowUp: isFollowUpPrompt(userMessage),
    lastEmailTarget,
    latestDocumentName: latestDocument?.name || "",
    summaryText: lines.join("\n"),
    recentRelevantMessages,
  };
}
