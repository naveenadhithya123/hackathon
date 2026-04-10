import { v4 as uuid } from "uuid";
import {
  buildConversationMessages,
  buildTutorSystemPrompt,
  extractTitleFromPrompt,
} from "../utils/promptBuilder.js";
import { buildChatMemory } from "../utils/chatMemory.js";
import { resolveConversationMessage } from "../utils/conversationResolver.js";
import {
  chatCompletion,
  generateImageFromPrompt,
  isImageGenerationPrompt,
  visionCompletion,
} from "../services/huggingface.service.js";
import { uploadBuffer } from "../services/cloudinary.service.js";
import { buildGeneratedDocument, hasLiteralContentRequest } from "../utils/documentGenerator.js";
import {
  createOrGetChatShare,
  createChat,
  getChatByIdForUser,
  getDocumentsByIds,
  getSharedChatByToken,
  listDocumentChunks,
  listChatsByUser,
  saveMessage,
} from "../services/supabase.service.js";

function isCodingPrompt(message = "") {
  const normalized = String(message).toLowerCase();
  return /\b(code|coding|program|function|class|bug|debug|fix|algorithm|dsa|data structure|react|node|express|html|css|javascript|typescript|java|python|sql|api|portfolio|website|web page|app)\b/i.test(
    normalized,
  );
}

function isDocumentPrompt(message = "") {
  const normalized = String(message).toLowerCase();
  return /\b(pdf|document|doc|notes|chapter|lecture|file|summary|summarize|extract|explain this pdf|question from pdf|content|image|screenshot)\b/i.test(
    normalized,
  );
}

function isDocumentFollowUpPrompt(message = "") {
  const normalized = String(message).trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return /\b(this|that|those|it|above|previous|before|same)\b/.test(normalized) ||
    /\b(answer|answers|questions|solve|solutions|from there|from that|from the pdf|from the document)\b/.test(normalized) ||
    normalized.length <= 40;
}

function isCreatorPrompt(message = "") {
  const normalized = String(message).toLowerCase();

  if (!normalized.trim()) {
    return false;
  }

  const creatorAction = /\b(create|generate|make|build|write|draft|prepare)\b/i;
  const creatorOutput =
    /\b(pdf|doc|docx|dox|word|text file|txt|worksheet|handout|notes?|document|file|summary|outline|study guide|report)\b/i;
  const exportAction =
    /\b(download(able)?|export|attachment|attach|save as|save it|send as file|create file|generate file|make file|build file)\b/i;
  const naturalRequestAction = /\b(need|want|provide|share|prepare)\b/i;
  const naturalRequestOutput =
    /\b(document|file|notes?|worksheet|handout|summary|outline|study guide|report)\b/i;

  return (creatorAction.test(normalized) && creatorOutput.test(normalized)) ||
    (exportAction.test(normalized) && creatorOutput.test(normalized)) ||
    (naturalRequestAction.test(normalized) && naturalRequestOutput.test(normalized)) ||
    (/\bgive me\b/i.test(normalized) && naturalRequestOutput.test(normalized)) ||
    /\b(pdf|doc|docx|dox|word|txt|text file)\b/i.test(normalized);
}

function wantsExplicitGeneratedFile(message = "") {
  const normalized = String(message).toLowerCase();

  if (!normalized) {
    return false;
  }

  return isCreatorPrompt(normalized) &&
    (
      /\b(pdf|doc|docx|word|txt|text file)\b/i.test(normalized) ||
      /\bdox\b/i.test(normalized) ||
      /\b(download(able)?|export|attachment|attach|send as file|save as file|create file|generate file|make file|build file)\b/i.test(normalized)
    );
}

function wantsCompleteCodeResponse(message = "") {
  const normalized = String(message).toLowerCase();

  if (!normalized) {
    return false;
  }

  return (
    /\b(complete|full|entire)\b.*\b(code|html|css|javascript|js|program|web ?page|website|app)\b/i.test(normalized) ||
    /\b(one|single)\s+(html|js|javascript|css)\s+file\b/i.test(normalized) ||
    /\bin\s+one\s+(html|js|javascript|css)\s+file\b/i.test(normalized)
  );
}

function scoreChunk(content = "", query = "") {
  const normalizedContent = content.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 2);

  let score = 0;

  for (const token of tokens) {
    if (normalizedContent.includes(token)) {
      score += token.length > 5 ? 3 : 2;
    }
  }

  if (normalizedContent.includes(query.toLowerCase())) {
    score += 8;
  }

  return score;
}

function buildImageConversationContext(history = []) {
  return history
    .filter((item) => item?.role && item?.content)
    .slice(-6)
    .map((item) => `${item.role}: ${item.content}`)
    .join("\n");
}

function isSimpleChatPrompt(message = "") {
  const normalized = String(message).trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return /^(hi|hello|hey|hii|helo|good morning|good afternoon|good evening|okay|ok|thanks|thank you|yo|sup|what's up|whats up)$/.test(
    normalized,
  );
}

function buildSimpleChatReply(message = "") {
  const normalized = String(message).trim().toLowerCase();

  if (/^thanks|^thank you/.test(normalized)) {
    return "You're welcome. If you want, ask your next question and I'll help right away.";
  }

  if (/^okay|^ok$/.test(normalized)) {
    return "Okay. Tell me what you want to do next, and I'll help you step by step.";
  }

  return "Hi. What would you like help with today: study, coding, documents, file creation, quiz prep, or images?";
}

function buildModeRefusal(mode = "study") {
  if (mode === "coding") {
    return "I'm Code AI. I can help with coding, debugging, algorithms, websites, apps, and programming concepts only.";
  }

  if (mode === "images") {
    return "I'm Image AI. I can create or edit images for you. Ask like `generate an image of ...` or `create an image of ...`.";
  }

  if (mode === "documents") {
    return "I'm Document AI. I work with PDFs, notes, screenshots, summaries, and document-based questions. Upload a file or ask something about a document.";
  }

  if (mode === "creator") {
    return "I'm Creator AI. I create downloadable PDF, DOC-style, and TXT study files for you.";
  }

  return "";
}

function mapChatError(error) {
  const message = String(error?.message || "");

  if (/429|rate limit|too many requests|status code \(no body\)/i.test(message)) {
    return "The AI model is busy right now. Please try again in a few seconds.";
  }

  if (/402|monthly included credits|depleted your monthly included credits|purchase pre-paid credits|subscribe to pro|get 20x more included usage|billing hard limit|insufficient quota/i.test(message)) {
    return "AI quota finished, please recharge.";
  }

  if (/401|incorrect api key provided|invalid api key/i.test(message)) {
    return "OpenAI fallback is not configured correctly. Please update the API key.";
  }

  if (/OpenAI fallback is busy or out of quota/i.test(message)) {
    return "OpenAI fallback is busy or out of quota. Please try another valid API key.";
  }

  if (/Groq fallback is not configured correctly/i.test(message)) {
    return "Groq fallback is not configured correctly. Please update the API key.";
  }

  if (/Gemini fallback is not configured correctly/i.test(message)) {
    return "Gemini fallback is not configured correctly. Please update the API key.";
  }

  if (/Gemini fallback is busy or out of quota/i.test(message)) {
    return "Gemini fallback is busy or out of quota. Please wait a minute and try again.";
  }

  if (/not supported by any provider/i.test(message)) {
    return "That analysis model is unavailable right now. Please try a simpler text-based question or upload a clearer text image.";
  }

  return message || "Something went wrong while generating the answer.";
}

function isProviderFailureMessage(message = "") {
  return /monthly included credits|billing hard limit|insufficient quota|incorrect api key|invalid api key|OpenAI fallback|Gemini fallback|too many requests|rate limit|resource has been exhausted|quota/i.test(
    String(message),
  );
}

function extractKnowledgeTopic(message = "") {
  const normalized = String(message).trim();

  if (!normalized) {
    return "";
  }

  const patterns = [
    /^(?:what is|what are)\s+(?:an?\s+|the\s+)?(.+?)\??$/i,
    /^(?:who is|who are)\s+(.+?)\??$/i,
    /^(?:tell me about|explain)\s+(.+?)\??$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return normalized.split(/\s+/).slice(0, 6).join(" ").trim();
}

function formatPossibleNameFromEmail(email = "") {
  const localPart = String(email).split("@")[0] || "";
  const cleaned = localPart.replace(/[0-9._-]+/g, " ").trim();

  if (!cleaned) {
    return "";
  }

  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildLocalFallbackAnswer(message = "", mode = "study", userEmail = "") {
  const normalized = String(message).trim().toLowerCase();
  const possibleName = formatPossibleNameFromEmail(userEmail);

  if (isSimpleChatPrompt(normalized)) {
    return buildSimpleChatReply(normalized);
  }

  if (/\b(do you know my name|what is my name|tell my name)\b/i.test(normalized)) {
    if (possibleName) {
      return `I can guess your name from the signed-in email as ${possibleName}. If you want, tell me the exact name you want me to use.`;
    }

    return "I do not know your exact name unless you tell me, but I can remember it within the conversation once you share it.";
  }

  if (/\bwho are you|what are you\b/i.test(normalized)) {
    return mode === "coding"
      ? "I'm Code AI. I help with programming, debugging, websites, apps, algorithms, and code explanations."
      : "I'm AI Hackathon. I help with study questions, coding help, document work, quizzes, and basic explanations.";
  }

  if (/\bwhat can you do|how can you help\b/i.test(normalized)) {
    return "I can help with study explanations, coding questions, website code, document summaries, quiz prep, and downloadable files. Right now I am using fallback mode, so simple answers work best.";
  }

  if (/\bwhat is a tree|what is tree\b/i.test(normalized)) {
    return "A tree is a tall plant with a woody stem or trunk, branches, and leaves. Trees make food by photosynthesis, release oxygen, and provide shade, fruit, wood, and shelter for living things.";
  }

  if (/\bwhat is a computer|what is computer\b/i.test(normalized)) {
    return "A computer is an electronic device that takes input, processes data according to instructions, and produces output. It is used for tasks such as calculation, communication, storage, and running software.";
  }

  if (/\bwhat is html\b/i.test(normalized)) {
    return "HTML stands for HyperText Markup Language. It is used to structure the content of web pages, such as headings, paragraphs, images, links, and forms.";
  }

  if (/\bwhat is css\b/i.test(normalized)) {
    return "CSS stands for Cascading Style Sheets. It is used to style web pages by controlling colors, spacing, layout, fonts, and responsiveness.";
  }

  if (/\bwhat is javascript\b/i.test(normalized)) {
    return "JavaScript is a programming language used to make web pages interactive. It can update content, respond to clicks, validate forms, and build dynamic web apps.";
  }

  if (/\bhero of (bigil|the movie bigil)\b/i.test(normalized)) {
    return "The hero of the movie Bigil is Vijay. He plays the lead role as Michael Rayappan, also called Bigil.";
  }

  if (/\bhero of (nanban|nunbam|namban)\b/i.test(normalized)) {
    return "If you mean the Tamil movie Nanban, the lead hero is Vijay. He plays Panchavan Parivendhan, the remake version of Rancho.";
  }

  return "The AI providers are unavailable right now, but the app is still running. Try a simpler question like `what is HTML`, `what is a tree`, `who are you`, or switch to document/image features for the demo.";
}

async function fetchWikipediaFallback(message = "") {
  const topic = extractKnowledgeTopic(message);

  if (!topic) {
    return "";
  }

  const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(topic)}&limit=1&namespace=0&format=json`;
  const searchResponse = await fetch(searchUrl, {
    headers: {
      "User-Agent": "AI-Hackathon/1.0",
    },
  });

  if (!searchResponse.ok) {
    return "";
  }

  const searchData = await searchResponse.json().catch(() => []);
  const title = searchData?.[1]?.[0];

  if (!title) {
    return "";
  }

  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const summaryResponse = await fetch(summaryUrl, {
    headers: {
      "User-Agent": "AI-Hackathon/1.0",
    },
  });

  if (!summaryResponse.ok) {
    return "";
  }

  const summaryData = await summaryResponse.json().catch(() => ({}));
  const extract = String(summaryData?.extract || "").trim();

  return extract || "";
}

function buildImageContextPrompt(message = "", imageContext = "") {
  return `Image context:\n${imageContext || "No text could be extracted from the image."}\n\nStudent request:\n${message || "Summarize this image in a simple way."}`;
}

function getLastCreatorUserPrompt(history = []) {
  const previousUserMessages = [...history]
    .reverse()
    .filter((item) => item?.role === "user" && item?.content)
    .map((item) => item.content);

  return previousUserMessages.find((content) => isCreatorPrompt(content)) || "";
}

function isCreatorFollowUpPrompt(message = "", history = []) {
  const normalized = String(message || "").trim();

  if (!normalized) {
    return false;
  }

  if (isSimpleChatPrompt(normalized) || isCreatorPrompt(normalized) || isImageGenerationPrompt(normalized)) {
    return false;
  }

  return Boolean(getLastCreatorUserPrompt(history));
}

function buildAutomaticDocumentPrompt(mode = "study") {
  if (mode === "coding") {
    return "Read the uploaded file and directly solve or explain the coding content. Start with the main answer first, then provide clean code blocks and a short explanation.";
  }

  if (mode === "documents") {
    return "Read the uploaded document and immediately give a concise summary, key points, important terms, and likely exam focus without asking follow-up questions first.";
  }

  return "Read the uploaded document and immediately explain what it contains in a clear student-friendly way. Start with a short overview, then key points, important ideas, and next things to study. Do not ask the user to paste the text.";
}

function buildDocumentAwarePrompt(message = "", mode = "study") {
  if (!message?.trim()) {
    return buildAutomaticDocumentPrompt(mode);
  }

  return `${message}

The file is already uploaded in this chat. Use the uploaded document directly and answer from it. Do not ask the user to re-upload the PDF, paste the questions, or repeat the document text unless the document context is actually empty.`;
}

export async function sendMessage(req, res) {
  let activeChatId = req.body.chatId ?? uuid();
  let fallbackUserId = "";
  let fallbackRequestMessage = "";
  let fallbackMode = "study";
  let fallbackUserEmail = "";

  try {
    const {
      chatId,
      userId,
      message,
      history = [],
      documentIds = [],
      attachments = [],
      imageUrl,
      imageContext = "",
      forceImageGeneration = false,
      mode = "study",
      userEmail = "",
    } = req.body;

    fallbackRequestMessage = message || "";
    fallbackMode = mode;
    fallbackUserEmail = userEmail || "";

    if (!message && !imageUrl && !documentIds.length) {
      return res.status(400).json({ error: "message, imageUrl, or documentIds is required." });
    }

    activeChatId = chatId ?? uuid();
    fallbackUserId = userId || "";
    const existingChat = chatId && userId
      ? await getChatByIdForUser(chatId, userId)
      : null;

    if (chatId && userId && !existingChat) {
      return res.status(403).json({ error: "You do not have access to this chat." });
    }

    if (userId && !existingChat) {
      await createChat({
        id: activeChatId,
        user_id: userId,
        title: extractTitleFromPrompt(message || attachments?.[0]?.name || "New chat"),
      });
    }

    if (userId && (message || documentIds.length || imageUrl)) {
      await saveMessage({
        chat_id: activeChatId,
        role: "user",
        content: message || "",
        metadata: {
          imageUrl: imageUrl ?? null,
          imageContext: imageContext || null,
          documentIds,
          attachments,
          mode,
          authorId: userId,
          authorEmail: userEmail || null,
        },
      });
    }

    let contextChunks = [];
    let retrievedContext = "";
    const resolvedConversation = await resolveConversationMessage({
      message: message || "",
      history,
      mode,
    });
    const resolvedUserMessage = resolvedConversation.normalizedMessage || message || "";
    const effectiveMessage = documentIds.length
      ? buildDocumentAwarePrompt(resolvedUserMessage, mode)
      : resolvedUserMessage || "";
    const chatMemory = buildChatMemory({
      history,
      userMessage: resolvedUserMessage || "",
      documentIds,
      attachments,
      mode,
    });
    const retrievalQuery =
      resolvedUserMessage && chatMemory.isFollowUp && chatMemory.recentRelevantMessages.length
        ? `${resolvedUserMessage}\n${chatMemory.recentRelevantMessages.join("\n")}`
        : effectiveMessage;

    const previousCreatorPrompt = getLastCreatorUserPrompt(history);
    const shouldTreatAsCreatorFollowUp =
      mode === "creator" &&
      Boolean(resolvedUserMessage) &&
      Boolean(previousCreatorPrompt) &&
      isCreatorFollowUpPrompt(resolvedUserMessage, history);

    const wantsGeneratedImage =
      Boolean(forceImageGeneration) ||
      (typeof effectiveMessage === "string" && isImageGenerationPrompt(effectiveMessage));
    const shouldGenerateDocument =
      !wantsGeneratedImage &&
      !imageUrl &&
      Boolean(resolvedUserMessage) &&
      (
        mode === "creator"
          ? isCreatorPrompt(resolvedUserMessage) || shouldTreatAsCreatorFollowUp
          : wantsExplicitGeneratedFile(resolvedUserMessage)
      );

    if (documentIds.length > 0 && userId) {
      const chunks = await listDocumentChunks(userId, documentIds, 120);
      contextChunks = resolvedUserMessage && !isDocumentFollowUpPrompt(resolvedUserMessage)
        ? chunks
            .map((chunk) => ({
              ...chunk,
              similarity: scoreChunk(chunk.content, retrievalQuery),
            }))
            .filter((chunk) => chunk.similarity > 0)
            .sort((left, right) => right.similarity - left.similarity)
            .slice(0, 6)
        : chunks.slice(0, 12).map((chunk, index) => ({
            ...chunk,
            similarity: Math.max(1, 12 - index),
          }));

      retrievedContext = contextChunks
        .map(
          (chunk, index) =>
            `Source ${index + 1} (${chunk.document_title ?? "Document"}): ${chunk.content}`,
        )
        .join("\n\n");

      if (!retrievedContext) {
        const documents = await getDocumentsByIds(userId, documentIds);
        retrievedContext = documents
          .map((document, index) => {
            const fallbackText =
              document.extracted_text?.trim() || document.summary?.trim() || "";

            if (!fallbackText) {
              return "";
            }

            return `Document ${index + 1} (${document.title}): ${fallbackText.slice(0, 4000)}`;
          })
          .filter(Boolean)
          .join("\n\n");
      }
    }

    const shouldPrioritizeLongCode =
      mode === "coding" ||
      wantsCompleteCodeResponse(resolvedUserMessage) ||
      (isCodingPrompt(resolvedUserMessage) && /\b(code|html|css|javascript|js|react|node|express|python|java)\b/i.test(resolvedUserMessage));
    const systemPrompt = buildTutorSystemPrompt(mode);
    const responseFocusedMessage = shouldPrioritizeLongCode
      ? `${effectiveMessage}

If you provide code, return the COMPLETE final code with no missing closing tags, braces, functions, or sections.
Do not stop in the middle of a code block.
Prefer one complete working solution over a partial solution with explanation first.`
      : effectiveMessage;
    const messages = buildConversationMessages({
      systemPrompt,
      history,
      userMessage: responseFocusedMessage,
      retrievedContext,
      chatMemory: chatMemory.summaryText,
    });

    const modeRefusal =
      mode === "coding" && resolvedUserMessage && !isCodingPrompt(resolvedUserMessage)
        ? buildModeRefusal("coding")
        : mode === "images" && !wantsGeneratedImage
          ? buildModeRefusal("images")
          : mode === "documents" &&
              resolvedUserMessage &&
              !documentIds.length &&
              !imageUrl &&
              !isDocumentPrompt(resolvedUserMessage)
            ? buildModeRefusal("documents")
            : mode === "creator" &&
                resolvedUserMessage &&
                !isCreatorPrompt(resolvedUserMessage) &&
                !shouldTreatAsCreatorFollowUp
              ? buildModeRefusal("creator")
              : "";

    let answer = "";
    let generatedImageUrl = null;
    let generatedFileUrl = null;
    let generatedFileName = null;
    let messageType = "chat";

    if (modeRefusal && !isSimpleChatPrompt(message)) {
      answer = modeRefusal;
    } else if (!wantsGeneratedImage && !imageUrl && isSimpleChatPrompt(message)) {
      answer = buildSimpleChatReply(message);
    } else if (shouldGenerateDocument) {
      const creatorPromptBase = resolvedUserMessage || message || "";
      const creatorPrompt =
        previousCreatorPrompt && previousCreatorPrompt !== creatorPromptBase
          ? `${previousCreatorPrompt}\n\nFollow-up correction: ${creatorPromptBase}`
          : creatorPromptBase;

      let generatedContent = "";

      if (!hasLiteralContentRequest(creatorPrompt)) {
        generatedContent = await chatCompletion({
          messages: buildConversationMessages({
            systemPrompt,
            history,
            userMessage: `${creatorPrompt}

Create the final file content only.
Do not explain how to make the file.
Do not add instructions.
If the user asks for one word or one short sentence only, output exactly that content only.`,
            retrievedContext,
          }),
          maxTokens: 1800,
        });
      }

      const generatedDocument = buildGeneratedDocument({
        prompt: creatorPrompt,
        content: generatedContent,
      });

      const uploadedFile = await uploadBuffer(generatedDocument.buffer, {
        folder: "edu-ai/generated-files",
        filename: generatedDocument.filename,
        mimeType: generatedDocument.mimeType,
        resourceType: "raw",
      });

      generatedFileUrl = uploadedFile.secureUrl;
      generatedFileName = generatedDocument.filename;
      messageType = "generated_document";
      answer =
        mode === "creator"
          ? `Your file is ready. I created ${generatedDocument.filename} for you.`
          : `Your file is ready. I created ${generatedDocument.filename} based on your request.`;
    } else if (wantsGeneratedImage) {
      const conversationContext = buildImageConversationContext(history);
      const generatedAsset = await generateImageFromPrompt(message, {
        referenceImageUrl: imageUrl || undefined,
        conversationContext,
      });

      const uploaded = await uploadBuffer(generatedAsset.buffer, {
        folder: "edu-ai/generated",
        filename: `generated-${Date.now()}.${generatedAsset.extension}`,
        mimeType: generatedAsset.mimeType,
        resourceType: "image",
      });

      generatedImageUrl = uploaded.secureUrl;
      messageType = "image_generation";
      answer = imageUrl
        ? "Here is the edited image based on your reference."
        : "Here is the generated image.";
    } else if (imageUrl && imageContext) {
      answer = await chatCompletion({
        messages: [
          {
            role: "system",
            content:
              "You are helping a student understand an uploaded image. Use the extracted text or the existing image summary first. If the context is limited, still help clearly without inventing details.",
          },
          {
            role: "user",
            content: buildImageContextPrompt(message, imageContext),
          },
        ],
        maxTokens: 900,
      });
    } else if (imageUrl) {
      try {
        answer = await visionCompletion({
          question: message || "Explain this image for a student.",
          imageUrl,
          context: retrievedContext,
        });
      } catch (_error) {
        answer =
          "I can see the uploaded image is attached, but advanced visual analysis is limited right now. If the image contains text, try uploading a clearer version or tell me exactly what you want me to explain.";
      }
    } else {
      answer = await chatCompletion({
        messages,
        maxTokens: shouldPrioritizeLongCode ? 2600 : 1200,
      });
    }

    if (userId) {
      await saveMessage({
        chat_id: activeChatId,
        role: "assistant",
        content: answer,
        metadata: {
          imageUrl: generatedImageUrl,
          fileUrl: generatedFileUrl,
          fileName: generatedFileName,
          messageType,
          mode,
          sources: contextChunks.map((chunk) => ({
            id: chunk.document_id,
            title: chunk.document_title,
            similarity: chunk.similarity,
          })),
        },
      });
    }

    return res.json({
      chatId: activeChatId,
      answer,
      generatedImageUrl,
      generatedFileUrl,
      generatedFileName,
      messageType,
      sources: contextChunks.map((chunk) => ({
        documentId: chunk.document_id,
        title: chunk.document_title,
        similarity: chunk.similarity,
      })),
    });
  } catch (error) {
    const rawMessage = String(error?.message || "");

    if (isProviderFailureMessage(rawMessage) && fallbackRequestMessage) {
      let fallbackAnswer = "";

      if (fallbackMode !== "coding" && fallbackMode !== "creator" && fallbackMode !== "images") {
        try {
          fallbackAnswer = await fetchWikipediaFallback(fallbackRequestMessage);
        } catch (_fallbackError) {
          fallbackAnswer = "";
        }
      }

      fallbackAnswer ||= buildLocalFallbackAnswer(fallbackRequestMessage, fallbackMode, fallbackUserEmail);

      if (fallbackUserId) {
        await saveMessage({
          chat_id: activeChatId,
          role: "assistant",
          content: fallbackAnswer,
          metadata: {
            imageUrl: null,
            fileUrl: null,
            fileName: null,
            messageType: "chat",
            mode: fallbackMode,
            sources: [],
          },
        });
      }

      return res.json({
        chatId: activeChatId,
        answer: fallbackAnswer,
        generatedImageUrl: null,
        generatedFileUrl: null,
        generatedFileName: null,
        messageType: "chat",
        sources: [],
      });
    }

    const friendlyError = mapChatError(error);
    const statusCode = /busy right now|quota has been reached/i.test(friendlyError) ? 503 : 500;
    return res.status(statusCode).json({ error: friendlyError });
  }
}

export async function getChatHistory(req, res) {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "userId is required." });
    }

    const chats = await listChatsByUser(userId);
    return res.json({ chats });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function createChatShareLink(req, res) {
  try {
    const { chatId } = req.params;
    const { userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({ error: "chatId and userId are required." });
    }

    const share = await createOrGetChatShare(chatId, userId);
    return res.json({
      chatId: share.chat_id,
      shareToken: share.share_token,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function getSharedChat(req, res) {
  try {
    const { token } = req.params;
    const { userId } = req.query;

    if (!token || !userId) {
      return res.status(400).json({ error: "share token and userId are required." });
    }

    const chat = await getSharedChatByToken(token, userId);

    if (!chat) {
      return res.status(404).json({ error: "Shared chat not found." });
    }

    return res.json({ chat });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
