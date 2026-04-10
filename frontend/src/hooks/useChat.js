import { useState } from "react";
import { getHistory, sendChatMessage } from "../services/api.js";
import { createWelcomeMessage } from "../store/chatStore.js";

function findLatestAssistantAnswer(messages = []) {
  return [...(messages || [])]
    .reverse()
    .find((message) => message?.role === "assistant" && String(message.content || "").trim())
    ?.content || "";
}

function sortChatMessages(messages = []) {
  return [...(messages || [])].sort((left, right) => {
    const leftTime = left?.created_at ? new Date(left.created_at).getTime() : 0;
    const rightTime = right?.created_at ? new Date(right.created_at).getTime() : 0;

    if (leftTime && rightTime && leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return 0;
  });
}

export function useChat({ userId }) {
  const [chats, setChats] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [messages, setMessages] = useState([createWelcomeMessage()]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastAssistantAnswer, setLastAssistantAnswer] = useState("");

  async function loadHistory() {
    if (!userId) {
      return;
    }

    const result = await getHistory(userId);
    setChats(result.chats || []);
  }

  function startNewChat() {
    setCurrentChatId(null);
    setMessages([createWelcomeMessage()]);
    setLastAssistantAnswer("");
  }

  function openChat(chat) {
    setCurrentChatId(chat.id);
    const mappedMessages = sortChatMessages(chat.messages || []).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        attachments: message.metadata?.attachments || [],
        sources: message.metadata?.sources || [],
        imageUrl: message.metadata?.imageUrl || "",
        fileUrl: message.metadata?.fileUrl || "",
        fileName: message.metadata?.fileName || "",
        messageType: message.metadata?.messageType || "chat",
        status: "done",
        animate: false,
      }));

    setMessages(mappedMessages);
    setLastAssistantAnswer(findLatestAssistantAnswer(mappedMessages));
  }

  async function sendMessage({
    content,
    documentIds = [],
    attachments = [],
    imageUrl,
    imageContext,
    forceImageGeneration = false,
    optimisticAssistant,
    mode = "study",
    userEmail = "",
  }) {
    const primaryDocument = attachments.find((item) => item.type === "document");
    const optimisticUser = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      attachments,
      fileUrl: primaryDocument?.fileUrl || "",
      fileName: primaryDocument?.name || "",
      imageUrl: imageUrl || "",
      imageContext: imageContext || "",
      status: "done",
    };

    const nextMessages = optimisticAssistant
      ? [...messages, optimisticUser, optimisticAssistant]
      : [...messages, optimisticUser];

    setMessages(nextMessages);
    setIsLoading(true);

    try {
      const result = await sendChatMessage({
        chatId: currentChatId,
        userId,
        userEmail,
        message: content,
        documentIds,
        attachments,
        imageUrl,
        imageContext,
        forceImageGeneration,
        mode,
        history: nextMessages
          .filter(
            (message) =>
              (message.role === "user" || message.role === "assistant") &&
              message.status !== "pending",
          )
          .map((message) => ({
            role: message.role,
            content: message.content,
            attachments: message.attachments || [],
            imageUrl: message.imageUrl || "",
            fileUrl: message.fileUrl || "",
            fileName: message.fileName || "",
            messageType: message.messageType || "chat",
          })),
      });

      const assistantMessage = {
        id: optimisticAssistant?.id || `assistant-${Date.now()}`,
        role: "assistant",
        content: result.answer,
        sources: result.sources || [],
        imageUrl: result.generatedImageUrl || "",
        fileUrl: result.generatedFileUrl || "",
        fileName: result.generatedFileName || "",
        messageType: result.messageType || optimisticAssistant?.messageType || "chat",
        status: "done",
        animate: (result.messageType || optimisticAssistant?.messageType || "chat") === "chat",
      };

      setMessages((previous) => {
        if (!optimisticAssistant) {
          return [...previous, assistantMessage];
        }

        return previous.map((message) =>
          message.id === optimisticAssistant.id ? assistantMessage : message,
        );
      });
      setCurrentChatId(result.chatId || currentChatId);
      setLastAssistantAnswer(result.answer);
      await loadHistory();
    } catch (error) {
      setMessages((previous) => {
        if (!optimisticAssistant) {
          return [
            ...previous,
            {
              id: `assistant-error-${Date.now()}`,
              role: "assistant",
              content: error.message || "Something went wrong.",
              attachments: [],
              messageType: optimisticAssistant?.messageType || "chat",
              status: "done",
            },
          ];
        }

        return previous.map((message) =>
          message.id === optimisticAssistant.id
            ? {
                ...message,
                content: error.message || "Something went wrong.",
                messageType: optimisticAssistant.messageType || "chat",
                status: "done",
              }
            : message,
        );
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  }

  function appendAssistantMessage(message) {
    setMessages((previous) => [...previous, message]);
  }

  function appendLocalMessage(message) {
    setMessages((previous) => [...previous, message]);
  }

  return {
    chats,
    currentChatId,
    messages,
    isLoading,
    lastAssistantAnswer,
    loadHistory,
    startNewChat,
    openChat,
    sendMessage,
    appendAssistantMessage,
    appendLocalMessage,
  };
}
