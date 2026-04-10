import { useEffect, useMemo, useRef, useState } from "react";
import Login from "./components/Auth/Login.jsx";
import Signup from "./components/Auth/Signup.jsx";
import ChatWindow from "./components/Chat/ChatWindow.jsx";
import InputBar from "./components/Chat/InputBar.jsx";
import SidebarHistory from "./components/Chat/SidebarHistory.jsx";
import { useChat } from "./hooks/useChat.js";
import { useFileUpload } from "./hooks/useFileUpload.js";
import { useSpeech } from "./hooks/useSpeech.js";
import {
  bootstrapProfile,
  generateQuiz,
  resolveEmailIntent,
  sendAnswerEmail,
} from "./services/api.js";
import { supabase } from "./services/supabase.js";

const authEnabled = import.meta.env.VITE_ENABLE_AUTH === "true";

const AI_SPACES = [
  { id: "study", icon: "\u{1F4D8}", label: "Study", subtitle: "Concepts, exams, learning plans" },
  { id: "coding", icon: "\u{1F4BB}", label: "Coding", subtitle: "Programming, debugging, web apps" },
  { id: "images", icon: "\u{1F5BC}\uFE0F", label: "Images", subtitle: "Generate and edit images only" },
  { id: "documents", icon: "\u{1F4C4}", label: "Documents", subtitle: "PDFs, notes, summaries" },
  { id: "creator", icon: "\u270D\uFE0F", label: "Creator", subtitle: "Generate PDF, Word, and text files" },
  { id: "gallery", icon: "\u{1F5C2}\uFE0F", label: "Gallery", subtitle: "AI and uploaded image library" },
];

const MODE_PLACEHOLDERS = {
  study: "Ask a study question, topic doubt, or learning plan",
  coding: "Ask for code, debugging, website creation, or DSA help",
  images: "Ask like: generate an image of a classroom",
  documents: "Upload a PDF and ask about the document",
  creator: "Ask me to create a PDF, DOC, TXT, notes, or study handout",
};

function inferChatMode(chat) {
  const latestMode = [...(chat.messages || [])]
    .reverse()
    .find((message) => message.metadata?.mode)?.metadata?.mode;

  if (latestMode) {
    return latestMode;
  }

  const title = String(chat.title || "").toLowerCase();

  if (/\b(image|picture|photo|poster|illustration|art)\b/.test(title)) {
    return "images";
  }

  if (/\b(code|coding|html|css|javascript|react|node|python|java|portfolio|bug|debug|dsa)\b/.test(title)) {
    return "coding";
  }

  if (/\b(pdf|document|notes|summary|chapter|lecture|file)\b/.test(title)) {
    return "documents";
  }

  if (/\b(create pdf|create doc|word file|document creator|make pdf|make doc|generate file)\b/.test(title)) {
    return "creator";
  }

  return "study";
}

function looksLikeImageRequest(text) {
  const normalized = text.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return (
    /\b(generate|create|make|draw|design)\b\s+.*\b(image|picture|photo|illustration|art|logo|poster|diagram)\b/i.test(
      normalized,
    ) ||
    /\b(image|picture|photo|illustration|poster|diagram)\s+of\b/i.test(normalized) ||
    /\b(show me|give me|need|want)\b\s+.*\b(image|picture|photo|illustration|art|logo|poster|diagram)\b/i.test(
      normalized,
    ) ||
    /\b(draw|design)\b\s+.*\b(logo|poster|illustration|diagram)\b/i.test(normalized)
  );
}

function parseEmailIntent(text, lastAssistantAnswer, lastQuestion, fallbackEmail = "") {
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const asksToSendMail = /\b(send|mail|email)\b/i.test(text);
  const refersToOwnInbox = /\b(my mail|my email|my gmail|to my mail|to my email|to my gmail)\b/i.test(
    text,
  );

  if (!asksToSendMail) {
    return null;
  }

  const to = emailMatch?.[0] || (refersToOwnInbox ? fallbackEmail : "");

  if (!to) {
    return null;
  }

  const wantsWordFile = /\b(word|doc|docx)\b/i.test(text);
  const attachPdf = /\bpdf\b/i.test(text) || !wantsWordFile;
  const naturalMatch = text.match(
    /^(?:send|mail|email)\s+(.+?)\s+(?:to\s+(?:this\s+)?email|to)\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\s*$/i,
  );

  const explicitAnswer = naturalMatch?.[1]?.trim();
  const refersToExistingAnswer =
    !explicitAnswer ||
    /\b(this|that|it|same|previous|latest|above|current)\b/i.test(explicitAnswer) ||
    /\b(answer|mail|email|pdf|word|doc|docx)\b/i.test(explicitAnswer);
  const answer =
    explicitAnswer && !refersToExistingAnswer
      ? explicitAnswer
      : lastAssistantAnswer || "No previous answer was available.";

  return {
    to,
    attachPdf,
    attachmentFormat: wantsWordFile ? "doc" : "pdf",
    answer,
    question: explicitAnswer && !refersToExistingAnswer && answer === explicitAnswer ? "" : lastQuestion,
    subject: wantsWordFile ? "AI Tutor Answer DOC" : "AI Tutor Answer PDF",
  };
}

function isEmailAddressOnly(text = "") {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(text).trim());
}

function extractEmailAddress(text = "") {
  return String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
}

function isLooseEmailRecipientPrompt(text = "") {
  const normalized = String(text).trim();
  const email = extractEmailAddress(normalized);

  if (!email) {
    return false;
  }

  return isEmailAddressOnly(normalized) || /^to\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(normalized);
}

function isSendMailRequestWithoutAddress(text = "") {
  const normalized = String(text).trim();
  return /\b(send|mail|email)\b/i.test(normalized) && !isEmailAddressOnly(normalized) &&
    !extractEmailAddress(normalized);
}

function isEmailCorrectionPrompt(text = "") {
  const normalized = String(text).trim();

  if (!extractEmailAddress(normalized)) {
    return false;
  }

  if (isLooseEmailRecipientPrompt(normalized)) {
    return true;
  }

  return /\b(to\s+this|send\s+(?:it\s+)?to|use\s+this|use\s+this\s+one|this\s+one|not\s+that|not\s+this|instead|change\s+to|change\s+it\s+to|correct\s+email|correct\s+mail|send\s+here|use\s+this\s+mail|use\s+this\s+email|mail\s+this\s+to|email\s+this\s+to|send\s+the\s+mail\s+to|send\s+the\s+email\s+to|send\s+to\s+this|no\s+send\s+to|sorry\s+send\s+to|sorry\s+not\s+that|wrong\s+email|wrong\s+mail|use\s+another\s+email|use\s+another\s+mail)\b/i.test(
    normalized,
  );
}

function inferFollowUpEmailFormat(text = "") {
  const normalized = String(text).trim().toLowerCase();

  if (!normalized) {
    return "";
  }

  if (/\b(word|doc|docx)\b/.test(normalized)) {
    return "doc";
  }

  if (/\bpdf\b/.test(normalized)) {
    return "pdf";
  }

  return "";
}

function refusesEmailDelivery(text = "") {
  const normalized = String(text).trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return /\b(don'?t send|do not send|dont send|don't mail|dont mail|don't email|dont email|no email|not email|give me in the chat|give me in chat|in the chat itself|in chat itself|show in chat|reply in chat)\b/i
    .test(normalized);
}

function explicitlyRequestsEmailDelivery(text = "") {
  const normalized = String(text).trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return /\b(send|mail|email|resend|forward)\b/i.test(normalized);
}

function isExportStatusMessage(message = {}) {
  if (message?.role !== "assistant") {
    return false;
  }

  const content = String(message.content || "").trim().toLowerCase();
  if (!content) {
    return false;
  }

  return /^i have sent it to .+ in (pdf|word) format\.?$/.test(content) ||
    /i could not send the email right now/.test(content) ||
    /send me the email address, and i'll send the latest answer as an attachment/.test(content);
}

function extractConversationContext(messages = []) {
  let question = "";
  let answer = "";

  for (const message of messages || []) {
    const content = String(message?.content || "").trim();

    if (!content || message?.status === "pending" || isExportStatusMessage(message)) {
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

function buildEmailMessagesPayload(messages = []) {
  return (messages || []).map((message) => ({
    role: message.role,
    content: message.content,
    status: message.status || "done",
  }));
}

function createAttachmentPayload(items = []) {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    fileUrl: item.imageUrl || item.fileUrl || "",
  }));
}

function collectChatFileAttachments(messages = []) {
  const seen = new Set();

  return messages
    .flatMap((message) => {
      const attachmentItems = (message.attachments || []).map((attachment) => ({
        name: attachment.name,
        fileUrl: attachment.fileUrl,
        type: attachment.type || "document",
      }));

      if (message.fileUrl) {
        attachmentItems.push({
          name: message.fileName || "generated-file",
          fileUrl: message.fileUrl,
          type: "document",
        });
      }

      return attachmentItems;
    })
    .filter((item) => item.fileUrl)
    .filter((item) => {
      const key = `${item.name}-${item.fileUrl}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function collectGalleryImages(chats = [], currentMessages = [], pendingAttachments = []) {
  const seen = new Set();
  const items = [];

  const pushItem = (item) => {
    if (!item?.url) {
      return;
    }
    const key = `${item.kind}-${item.url}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push(item);
  };

  for (const chat of chats) {
    for (const message of chat.messages || []) {
      if (message.role === "assistant" && message.metadata?.imageUrl) {
        pushItem({
          kind: "generated",
          url: message.metadata.imageUrl,
          title: chat.title || "Generated image",
          subtitle: message.content || "AI generated image",
          updatedAt: chat.updated_at || message.created_at || Date.now(),
        });
      }

      if (message.role === "user" && message.metadata?.imageUrl) {
        pushItem({
          kind: "uploaded",
          url: message.metadata.imageUrl,
          title: chat.title || "Uploaded image",
          subtitle: message.content || "Uploaded by user",
          updatedAt: chat.updated_at || message.created_at || Date.now(),
        });
      }

      for (const attachment of message.metadata?.attachments || []) {
        if (attachment.type === "image" && attachment.fileUrl) {
          pushItem({
            kind: message.role === "assistant" ? "generated" : "uploaded",
            url: attachment.fileUrl,
            title: chat.title || "Image attachment",
            subtitle: attachment.name || "Image",
            updatedAt: chat.updated_at || message.created_at || Date.now(),
          });
        }
      }
    }
  }

  for (const message of currentMessages || []) {
    if (message.role === "assistant" && message.imageUrl) {
      pushItem({
        kind: "generated",
        url: message.imageUrl,
        title: "Current chat",
        subtitle: message.content || "AI generated image",
        updatedAt: Date.now(),
      });
    }

    if (message.role === "user" && message.imageUrl) {
      pushItem({
        kind: "uploaded",
        url: message.imageUrl,
        title: "Current chat",
        subtitle: message.content || "Uploaded image",
        updatedAt: Date.now(),
      });
    }
  }

  for (const attachment of pendingAttachments || []) {
    if (attachment.type === "image") {
      pushItem({
        kind: "uploaded",
        url: attachment.imageUrl || attachment.previewUrl,
        title: "Pending image",
        subtitle: attachment.name || "Image",
        updatedAt: Date.now(),
      });
    }
  }

  return items.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
}

function mergeAttachments(...groups) {
  const seen = new Set();

  return groups
    .flat()
    .filter((item) => item?.fileUrl)
    .filter((item) => {
      const key = `${item.name || "attachment"}-${item.fileUrl}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function buildEmailPayloadFromIntent(intent, fallback) {
  const format = intent.attachmentFormat === "doc" ? "doc" : "pdf";
  return {
    to: intent.to || fallback.to || "",
    attachPdf: format !== "doc",
    attachmentFormat: format,
    answer: fallback.answer,
    question: fallback.question,
    subject: format === "doc" ? "AI Tutor Answer DOC" : "AI Tutor Answer PDF",
    attachments: fallback.attachments || [],
    messages: fallback.messages || [],
  };
}

export default function App() {
  const [authMode, setAuthMode] = useState("login");
  const [session, setSession] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeMode, setActiveMode] = useState("study");
  const [sidebarView, setSidebarView] = useState("chats");
  const [galleryTab, setGalleryTab] = useState("generated");
  const [chatSearch, setChatSearch] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [composerValue, setComposerValue] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [pendingEmailRequest, setPendingEmailRequest] = useState(null);
  const [lastEmailTarget, setLastEmailTarget] = useState("");
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [activeDocumentIds, setActiveDocumentIds] = useState([]);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const fileInputRef = useRef(null);
  const userMenuRef = useRef(null);

  const userId = session?.user?.id ?? null;
  const userEmail = session?.user?.email ?? null;

  const {
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
  } = useChat({ userId });

  const { uploadDocument, uploadImage, uploadState } = useFileUpload();
  const {
    isRecording,
    audioLevel,
    transcript,
    isSpeaking,
    speakingText,
    startRecording,
    stopRecording,
    speak,
  } = useSpeech();

  useEffect(() => {
    if (!supabase || !authEnabled) {
      return undefined;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);

      if (nextSession?.user) {
        await bootstrapProfile({
          id: nextSession.user.id,
          email: nextSession.user.email,
          fullName: nextSession.user.user_metadata?.full_name || "",
        });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    const updateViewportMetrics = () => {
      const viewport = window.visualViewport;
      const layoutHeight = window.innerHeight;
      const appHeight = Math.min(layoutHeight, viewport?.height || layoutHeight);
      const viewportTop = viewport?.offsetTop || 0;
      const viewportBottomOffset = Math.max(
        0,
        layoutHeight - (appHeight + viewportTop),
      );
      root.style.setProperty("--app-height", `${Math.round(appHeight)}px`);
      root.style.setProperty("--viewport-bottom-offset", `${Math.round(viewportBottomOffset)}px`);
    };

    updateViewportMetrics();

    window.addEventListener("resize", updateViewportMetrics);
    window.addEventListener("orientationchange", updateViewportMetrics);
    window.visualViewport?.addEventListener("resize", updateViewportMetrics);
    window.visualViewport?.addEventListener("scroll", updateViewportMetrics);

    return () => {
      window.removeEventListener("resize", updateViewportMetrics);
      window.removeEventListener("orientationchange", updateViewportMetrics);
      window.visualViewport?.removeEventListener("resize", updateViewportMetrics);
      window.visualViewport?.removeEventListener("scroll", updateViewportMetrics);
    };
  }, []);

  useEffect(() => {
    if (userId) {
      loadHistory();
    }
  }, [userId]);

  useEffect(() => {
    if (!isUserMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!userMenuRef.current?.contains(event.target)) {
        setIsUserMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isUserMenuOpen]);

  const canUseApp = !authEnabled || !!session || !supabase;
  const showSidebarContent = sidebarOpen || mobileSidebarOpen;

  const filteredChats = useMemo(() => {
    const term = chatSearch.trim().toLowerCase();
    if (!term) {
      return chats;
    }

    return chats.filter((chat) => {
      const title = String(chat.title || "").toLowerCase();
      const body = (chat.messages || [])
        .map((message) => `${message.content || ""} ${message.metadata?.mode || ""}`)
        .join(" ")
        .toLowerCase();
      return title.includes(term) || body.includes(term);
    });
  }, [chatSearch, chats]);
  const chatFileAttachments = useMemo(() => collectChatFileAttachments(messages), [messages]);
  const galleryItems = useMemo(
    () => collectGalleryImages(chats, messages, pendingAttachments),
    [chats, messages, pendingAttachments],
  );
  const visibleGalleryItems = useMemo(
    () => galleryItems.filter((item) => item.kind === galleryTab),
    [galleryItems, galleryTab],
  );
  const latestConversationContext = useMemo(
    () => extractConversationContext(messages),
    [messages],
  );
  const emailMessageContext = useMemo(
    () => buildEmailMessagesPayload(messages),
    [messages],
  );
  const latestQuestion = latestConversationContext.question || lastQuestion;
  const latestAnswer = latestConversationContext.answer || lastAssistantAnswer;

  function handleNewChat() {
    startNewChat();
    setPendingAttachments([]);
    setActiveDocumentIds([]);
    setComposerValue("");
    setLastQuestion("");
    setPendingEmailRequest(null);
    setLastEmailTarget("");
    setSidebarView("chats");
    setMobileSidebarOpen(false);
  }

  async function attachFile(file) {
    setIsUploadingAttachment(true);
    const optimisticAttachment = {
      id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      type: file.type.startsWith("image/") ? "image" : "document",
      status: "uploading",
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
    };

    setPendingAttachments((previous) => [...previous, optimisticAttachment]);

    try {
      const result = file.type.startsWith("image/")
        ? await uploadImage(file)
        : await uploadDocument(file, userId);

      setPendingAttachments((previous) =>
        previous.map((item) =>
          item.id === optimisticAttachment.id
            ? {
                ...item,
                status: "ready",
                imageUrl: result.imageUrl || result.fileUrl || "",
                documentId: result.document?.id || null,
                summary: result.summary || "",
                extractedText: result.extractedText || "",
                note:
                  result.document?.id || result.imageUrl
                    ? "Ready"
                    : result.extractionNote || result.fallbackNote || "",
              }
            : item,
        ),
      );

      if (result.document?.id) {
        setActiveDocumentIds((previous) =>
          previous.includes(result.document.id) ? previous : [...previous, result.document.id],
        );
      }

    } catch (error) {
      setPendingAttachments((previous) =>
        previous.map((item) =>
          item.id === optimisticAttachment.id
            ? { ...item, status: "error", error: error.message }
            : item,
        ),
      );
    } finally {
      setIsUploadingAttachment(false);
    }
  }

  async function handleFilePicker(event) {
    const files = Array.from(event.target.files || []);
    for (const file of files) {
      await attachFile(file);
    }
    event.target.value = "";
  }

  async function handlePaste(event) {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) {
      return;
    }

    event.preventDefault();
    for (const file of files) {
      await attachFile(file);
    }
  }

  function removeAttachment(id) {
    const removed = pendingAttachments.find((item) => item.id === id);
    setPendingAttachments((previous) => previous.filter((item) => item.id !== id));

    if (removed?.documentId) {
      setActiveDocumentIds((previous) =>
        previous.filter((documentId) => documentId !== removed.documentId),
      );
    }
  }

  async function handleMic() {
    try {
      if (isRecording) {
        setIsProcessingAction(true);
        const text = await stopRecording();
        if (text) {
          setComposerValue(text);
        }
        setIsProcessingAction(false);
        return;
      }

      await startRecording();
    } catch (error) {
      setIsProcessingAction(false);
      appendAssistantMessage({
        id: `assistant-mic-error-${Date.now()}`,
        role: "assistant",
        content:
          error.message ||
          "Voice input is not available on this phone right now. Please allow microphone access and try again.",
        status: "done",
      });
    }
  }

  async function handleLogout() {
    if (!supabase || !authEnabled) {
      return;
    }

    await supabase.auth.signOut();
    setIsUserMenuOpen(false);
  }

  async function handleSend() {
    let draftValue = composerValue;

    if (isRecording) {
      setIsProcessingAction(true);
      const text = await stopRecording();
      if (text) {
        const nextValue = `${draftValue}${draftValue ? " " : ""}${text}`.trim();
        setComposerValue(nextValue);
        draftValue = nextValue;
        setIsProcessingAction(false);
        if (!nextValue) {
          return;
        }
      } else {
        setIsProcessingAction(false);
      }
    }

    const hasUploadingAttachments = pendingAttachments.some((item) => item.status === "uploading");

    if (isLoading || isProcessingAction || hasUploadingAttachments) {
      return;
    }

    const trimmed = draftValue.trim();
    const readyDocs = pendingAttachments
      .filter((item) => item.status === "ready" && item.type === "document")
      .map((item) => item.documentId)
      .filter(Boolean);
    const documentIds = [...new Set([...activeDocumentIds, ...readyDocs])];
    const readyImage = pendingAttachments.find(
      (item) => item.status === "ready" && item.type === "image",
    );
    const readyAttachments = pendingAttachments.filter((item) => item.status === "ready");
    const availableEmailAttachments = mergeAttachments(
      chatFileAttachments,
      createAttachmentPayload(readyAttachments),
    );
    const imageContext = [readyImage?.summary, readyImage?.extractedText]
      .filter(Boolean)
      .join("\n\n");

    if (!trimmed && !readyImage) {
      return;
    }

    setIsProcessingAction(true);
    setComposerValue("");

    function appendCommandBubble(text) {
      appendLocalMessage({
        id: `user-command-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "user",
        content: text,
        status: "done",
      });
    }

    const asksQuiz = /^\/quiz\b/i.test(trimmed);
    const declinesEmailDelivery = refusesEmailDelivery(trimmed);
    const asksExplicitEmailDelivery = explicitlyRequestsEmailDelivery(trimmed);
    const followUpEmailFormat = inferFollowUpEmailFormat(trimmed);
    const emailFallback = {
      to: lastEmailTarget || userEmail || "",
      answer: pendingEmailRequest?.answer || latestAnswer || "No previous answer was available.",
      question: pendingEmailRequest?.question || latestQuestion,
      attachments: availableEmailAttachments,
      messages: pendingEmailRequest?.messages || emailMessageContext,
    };
    const resolvedEmailIntent =
      !/^\/email\s+/i.test(trimmed) &&
      !declinesEmailDelivery &&
      (pendingEmailRequest || /@/.test(trimmed) || /\b(send|mail|email|not that|to this|use this|resend)\b/i.test(trimmed))
        ? await resolveEmailIntent({
            message: trimmed,
            fallbackEmail: userEmail || "",
            lastEmailTarget,
            lastQuestion: latestQuestion,
            lastAssistantAnswer: latestAnswer,
            pendingEmailRequest,
          }).catch(() => ({ isEmailIntent: false }))
        : { isEmailIntent: false };
    const correctedRecipientIntent =
      !declinesEmailDelivery && (pendingEmailRequest || lastEmailTarget) && isEmailCorrectionPrompt(trimmed)
        ? {
            to: extractEmailAddress(trimmed),
            attachPdf: pendingEmailRequest?.attachPdf ?? true,
            attachmentFormat: pendingEmailRequest?.attachmentFormat || "pdf",
            answer: pendingEmailRequest?.answer || latestAnswer || "No previous answer was available.",
            question: pendingEmailRequest?.question || latestQuestion,
            subject: pendingEmailRequest?.subject || "AI Tutor Answer PDF",
            attachments: availableEmailAttachments,
            messages: pendingEmailRequest?.messages || emailMessageContext,
          }
        : null;
    const pendingRecipientIntent =
      !declinesEmailDelivery && pendingEmailRequest && isLooseEmailRecipientPrompt(trimmed)
        ? {
            ...pendingEmailRequest,
            to: extractEmailAddress(trimmed),
          }
        : null;
    const emailIntent = /^\/email\s+/i.test(trimmed)
      ? (() => {
          const match = trimmed.match(/^\/email\s+([^\s]+)\s*(.*)$/i);
          if (!match) {
            return null;
          }
          return {
            to: match[1],
            attachPdf: !/\b(word|doc|docx)\b/i.test(match[2] || ""),
            attachmentFormat: /\b(word|doc|docx)\b/i.test(match[2] || "") ? "doc" : "pdf",
            answer: latestAnswer || "No previous answer was available.",
            question: latestQuestion,
            subject: /\b(word|doc|docx)\b/i.test(match[2] || "")
              ? "AI Tutor Answer DOC"
              : "AI Tutor Answer PDF",
            attachments: availableEmailAttachments,
            messages: emailMessageContext,
          };
        })()
      : (() => {
          const parsed = parseEmailIntent(trimmed, latestAnswer, latestQuestion, userEmail);
          if (parsed) {
            return { ...parsed, attachments: availableEmailAttachments, messages: emailMessageContext };
          }

          if (resolvedEmailIntent?.isEmailIntent) {
            return buildEmailPayloadFromIntent(resolvedEmailIntent, emailFallback);
          }

          return null;
        })();
    const asksImage = looksLikeImageRequest(trimmed);

    if (declinesEmailDelivery) {
      setPendingEmailRequest(null);
      setLastEmailTarget("");
    }

    if (asksQuiz) {
      setLastQuestion(trimmed);
      const sourceText =
        pendingAttachments.find((item) => item.extractedText)?.extractedText || "";
      const quizResult = await generateQuiz({
        sourceText,
        title: "Study Quiz",
        difficulty: "medium",
        count: 5,
      });

      appendAssistantMessage({
        id: `assistant-quiz-${Date.now()}`,
        role: "assistant",
        content: `Quiz ready:\n\n${quizResult.quiz.questions
          .map(
            (item, index) =>
              `${index + 1}. ${item.question}\nOptions: ${item.options.join(", ")}\nAnswer: ${item.answer}`,
          )
          .join("\n\n")}`,
        status: "done",
      });

      setIsProcessingAction(false);
      return;
    }

    if (emailIntent) {
      try {
        appendCommandBubble(trimmed);
        setPendingEmailRequest(null);
        await sendAnswerEmail(emailIntent);
        setLastEmailTarget(emailIntent.to);
        appendAssistantMessage({
          id: `assistant-email-${Date.now()}`,
          role: "assistant",
          content:
            emailIntent.attachmentFormat === "doc"
              ? `I have sent it to ${emailIntent.to} in Word format.`
              : `I have sent it to ${emailIntent.to} in PDF format.`,
          status: "done",
        });
      } catch (error) {
        appendAssistantMessage({
          id: `assistant-email-error-${Date.now()}`,
          role: "assistant",
          content:
            error.message ||
            "I could not send the email right now. Please check the email configuration and try again.",
          status: "done",
        });
      } finally {
        setIsProcessingAction(false);
      }
      return;
    }

    if (pendingRecipientIntent) {
      try {
        appendCommandBubble(trimmed);
        setPendingEmailRequest(null);
        await sendAnswerEmail({
          ...pendingRecipientIntent,
          attachments: availableEmailAttachments,
        });
        setLastEmailTarget(pendingRecipientIntent.to);
        appendAssistantMessage({
          id: `assistant-email-${Date.now()}`,
          role: "assistant",
          content:
            pendingRecipientIntent.attachmentFormat === "doc"
              ? `I have sent it to ${pendingRecipientIntent.to} in Word format.`
              : `I have sent it to ${pendingRecipientIntent.to} in PDF format.`,
          status: "done",
        });
      } catch (error) {
        appendAssistantMessage({
          id: `assistant-email-error-${Date.now()}`,
          role: "assistant",
          content:
            error.message ||
            "I could not send the email right now. Please check the email configuration and try again.",
          status: "done",
        });
      } finally {
        setIsProcessingAction(false);
      }
      return;
    }

    if (correctedRecipientIntent?.to) {
      try {
        appendCommandBubble(trimmed);
        setPendingEmailRequest(null);
        await sendAnswerEmail(correctedRecipientIntent);
        setLastEmailTarget(correctedRecipientIntent.to);
        appendAssistantMessage({
          id: `assistant-email-correction-${Date.now()}`,
          role: "assistant",
          content:
            correctedRecipientIntent.attachmentFormat === "doc"
              ? `I have sent it to ${correctedRecipientIntent.to} in Word format.`
              : `I have sent it to ${correctedRecipientIntent.to} in PDF format.`,
          status: "done",
        });
      } catch (error) {
        appendAssistantMessage({
          id: `assistant-email-correction-error-${Date.now()}`,
          role: "assistant",
          content:
            error.message ||
            "I could not send the email right now. Please check the email configuration and try again.",
          status: "done",
        });
      } finally {
        setIsProcessingAction(false);
      }
      return;
    }

    if (lastEmailTarget && asksExplicitEmailDelivery && followUpEmailFormat) {
      try {
        appendCommandBubble(trimmed);
        await sendAnswerEmail({
          to: lastEmailTarget,
          attachPdf: followUpEmailFormat !== "doc",
          attachmentFormat: followUpEmailFormat,
          answer: latestAnswer || "No previous answer was available.",
          question: latestQuestion,
          subject: followUpEmailFormat === "doc" ? "AI Tutor Answer DOC" : "AI Tutor Answer PDF",
          attachments: availableEmailAttachments,
          messages: emailMessageContext,
        });
        appendAssistantMessage({
          id: `assistant-email-followup-${Date.now()}`,
          role: "assistant",
          content:
            followUpEmailFormat === "doc"
              ? `I have sent it to ${lastEmailTarget} in Word format.`
              : `I have sent it to ${lastEmailTarget} in PDF format.`,
          status: "done",
        });
      } catch (error) {
        appendAssistantMessage({
          id: `assistant-email-followup-error-${Date.now()}`,
          role: "assistant",
          content:
            error.message ||
            "I could not send the email right now. Please check the email configuration and try again.",
          status: "done",
        });
      } finally {
        setIsProcessingAction(false);
      }
      return;
    }

    if (isSendMailRequestWithoutAddress(trimmed)) {
      const wantsWordFile = /\b(word|doc|docx)\b/i.test(trimmed);
      if (userEmail) {
        try {
          appendCommandBubble(trimmed);
          await sendAnswerEmail({
            to: userEmail,
            attachPdf: !wantsWordFile,
            attachmentFormat: wantsWordFile ? "doc" : "pdf",
            answer: latestAnswer || "No previous answer was available.",
            question: latestQuestion,
            subject: wantsWordFile ? "AI Tutor Answer DOC" : "AI Tutor Answer PDF",
            attachments: availableEmailAttachments,
            messages: emailMessageContext,
          });
          setLastEmailTarget(userEmail);
          appendAssistantMessage({
            id: `assistant-email-${Date.now()}`,
            role: "assistant",
            content: wantsWordFile
              ? `I have sent it to ${userEmail} in Word format.`
              : `I have sent it to ${userEmail} in PDF format.`,
            status: "done",
          });
        } catch (error) {
          appendAssistantMessage({
            id: `assistant-email-error-${Date.now()}`,
            role: "assistant",
            content:
              error.message ||
              "I could not send the email right now. Please check the email configuration and try again.",
            status: "done",
          });
        } finally {
          setIsProcessingAction(false);
        }
        return;
      }

      setPendingEmailRequest({
        attachPdf: !wantsWordFile,
        attachmentFormat: wantsWordFile ? "doc" : "pdf",
        answer: latestAnswer || "No previous answer was available.",
        question: latestQuestion,
        subject: wantsWordFile ? "AI Tutor Answer DOC" : "AI Tutor Answer PDF",
        messages: emailMessageContext,
      });
      appendAssistantMessage({
        id: `assistant-email-prompt-${Date.now()}`,
        role: "assistant",
        content: "Send me the email address, and I'll send the latest answer as an attachment.",
        status: "done",
      });
      setIsProcessingAction(false);
      return;
    }

    setLastQuestion(trimmed);

    const optimisticAssistant = {
      id: `assistant-pending-${Date.now()}`,
      role: "assistant",
      content: asksImage ? "Generating image..." : "Thinking...",
      imageUrl: "",
      messageType: asksImage ? "image_generation" : "chat",
      status: "pending",
    };

    try {
      await sendMessage({
        content: trimmed,
        documentIds,
        attachments: createAttachmentPayload(readyAttachments),
        imageUrl: readyImage?.imageUrl || undefined,
        imageContext: imageContext || undefined,
        forceImageGeneration: asksImage,
        optimisticAssistant,
        mode: activeMode,
        userEmail: userEmail || "",
      });
    } finally {
      setPendingAttachments((previous) => previous.filter((item) => item.status !== "ready"));
      setIsProcessingAction(false);
    }
  }

  function handleOpenChat(chat) {
    openChat(chat);
    const chatContext = extractConversationContext(
      sortChatMessages(chat.messages || []).map((message) => ({
        role: message.role,
        content: message.content,
        status: "done",
      })),
    );
    setPendingAttachments([]);
    setLastQuestion(chatContext.question || "");
    const linkedDocumentIds = [
      ...new Set(
        (chat.messages || [])
          .flatMap((message) => message.metadata?.documentIds || [])
          .filter(Boolean),
      ),
    ];
    setActiveDocumentIds(linkedDocumentIds);
    setSidebarView("chats");
    setMobileSidebarOpen(false);
  }

  async function handleShareCurrentChat() {
    const transcript = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => `${message.role === "user" ? "User" : "AI"}: ${message.content || ""}`)
      .join("\n\n")
      .trim();

    if (!transcript) {
      return;
    }

    const payload = {
      title: "AI Hackathon Chat",
      text: transcript,
    };

    try {
      if (navigator.share) {
        await navigator.share(payload);
        return;
      }

      await navigator.clipboard.writeText(transcript);
    } catch (_error) {
      // ignore user cancellation
    }
  }

  if (!canUseApp) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>AI Hackathon</h1>
          <p>Sign in to save chats, attachments, and folders in Supabase.</p>
          {authMode === "login" ? (
            <Login onSwitch={() => setAuthMode("signup")} />
          ) : (
            <Signup onSwitch={() => setAuthMode("login")} />
          )}
        </div>
      </div>
    );
  }

  const composerProps = {
    value: composerValue,
    onChange: setComposerValue,
    onSend: handleSend,
    onPaste: handlePaste,
    disabled: isLoading,
    isRecording,
    audioLevel,
    transcript,
    uploadState,
    attachments: pendingAttachments,
    onRemoveAttachment: removeAttachment,
    onOpenFilePicker: () => fileInputRef.current?.click(),
    onMic: handleMic,
    isBusy: isLoading || isProcessingAction,
    hasUploadingAttachments:
      isUploadingAttachment || pendingAttachments.some((item) => item.status === "uploading"),
    placeholder: MODE_PLACEHOLDERS[activeMode],
  };

  return (
    <div className="chatgpt-shell">
      <div
        className={`sidebar-backdrop ${mobileSidebarOpen ? "visible" : ""}`}
        onClick={() => setMobileSidebarOpen(false)}
      />
      <aside className={`left-rail ${sidebarOpen ? "open" : "collapsed"} ${mobileSidebarOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-top">
            <div className="sidebar-brand">
              <div className="sidebar-logo" aria-hidden="true">
                <span className="sidebar-logo-orbit" />
                <span className="sidebar-logo-core" />
                <span className="sidebar-logo-spark" />
              </div>
            </div>
            {sidebarOpen ? (
            <button className="new-chat-button" onClick={handleNewChat}>
              New chat
            </button>
          ) : null}
          <button
            className="icon-button sidebar-toggle-button"
            onClick={() => {
              if (window.innerWidth <= 900) {
                setMobileSidebarOpen((value) => !value);
              } else {
                setSidebarOpen((value) => !value);
              }
            }}
            aria-label="Toggle sidebar"
          >
            <span className="sidebar-toggle-icon" />
          </button>
        </div>

        {showSidebarContent ? (
          <>
            <div className="sidebar-panel sidebar-tools-panel sidebar-section-plain">
              <div className="sidebar-section-head">
                <span>Assistants</span>
                <span className="sidebar-section-note">Workflows</span>
              </div>
              <div className="folder-list folder-grid">
                {AI_SPACES.map((folder) => (
                  <button
                    key={folder.id}
                    className={`folder-chip ${
                      folder.id === "gallery"
                        ? sidebarView === "gallery" ? "active" : ""
                        : activeMode === folder.id && sidebarView === "chats" ? "active" : ""
                    }`}
                    title={folder.label}
                    aria-label={folder.label}
                    onClick={() => {
                      if (folder.id === "gallery") {
                        setSidebarView("gallery");
                        setMobileSidebarOpen(false);
                        return;
                      }
                      setSidebarView("chats");
                      setActiveMode(folder.id);
                      handleNewChat();
                    }}
                  >
                    <span className="folder-chip-icon" aria-hidden="true">{folder.icon}</span>
                    <span className="folder-chip-meta">
                      <span className="folder-chip-title">{folder.label}</span>
                      <span className="folder-chip-subtitle">{folder.subtitle}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="sidebar-panel sidebar-history-panel sidebar-section-plain">
              <div className="sidebar-section-head">
                <span>Recent Chats</span>
                <span className="sidebar-section-count">{filteredChats.length}</span>
              </div>
              <input
                className="chat-search-input"
                value={chatSearch}
                onChange={(event) => setChatSearch(event.target.value)}
                placeholder="Search chats"
              />
              <SidebarHistory
                chats={filteredChats}
                currentChatId={currentChatId}
                onSelectChat={handleOpenChat}
              />
            </div>
          </>
        ) : null}
      </aside>

      <main className="main-stage">
        <header className="topbar">
          <div className="topbar-brand">
            <button
              className="icon-button mobile-nav-button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <span className="mobile-nav-dots" />
            </button>
            <h1>Smart GPT🐦‍🔥</h1>
            <p>{AI_SPACES.find((space) => space.id === activeMode)?.subtitle || "Advanced AI workspace"}</p>
          </div>
          <div className="topbar-actions">
            <button className="pill-button" onClick={handleShareCurrentChat}>
              Share chat
            </button>
            <div className="user-menu" ref={userMenuRef}>
              <button
                className="user-badge user-menu-trigger"
                type="button"
                onClick={() => {
                  if (userEmail) {
                    setIsUserMenuOpen((value) => !value);
                  }
                }}
              >
                {userEmail || "Guest mode"}
              </button>
              {isUserMenuOpen ? (
                <div className="user-menu-panel">
                  <button className="user-menu-item" type="button" onClick={handleLogout}>
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {sidebarView === "gallery" ? (
          <section className="conversation-scroll">
            <div className="conversation-inner gallery-main-view">
              <div className="gallery-main-tabs">
                <button
                  className={`ghost-button sidebar-switch ${galleryTab === "generated" ? "active" : ""}`}
                  onClick={() => setGalleryTab("generated")}
                >
                  AI Generated Images
                </button>
                <button
                  className={`ghost-button sidebar-switch ${galleryTab === "uploaded" ? "active" : ""}`}
                  onClick={() => setGalleryTab("uploaded")}
                >
                  Uploaded Images
                </button>
              </div>
              <div className="gallery-main-grid">
                {visibleGalleryItems.length ? (
                  visibleGalleryItems.map((item) => (
                    <a className="gallery-main-card" key={`${item.kind}-${item.url}`} href={item.url} target="_blank" rel="noreferrer">
                      <img src={item.url} alt={item.title} />
                      <strong>{item.title}</strong>
                      <span>{item.subtitle}</span>
                    </a>
                  ))
                ) : (
                  <div className="history-empty">No images available yet.</div>
                )}
              </div>
            </div>
          </section>
        ) : (
          <>
            <ChatWindow
              messages={messages}
              onSpeakMessage={speak}
              isSpeaking={isSpeaking}
              speakingText={speakingText}
            />

            <InputBar {...composerProps} />
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept=".pdf,.txt,.md,.png,.jpg,.jpeg,image/*"
          onChange={handleFilePicker}
        />
      </main>
    </div>
  );
}
