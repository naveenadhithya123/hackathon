/**
 * huggingface.service.js
 *
 * ALL calls go through https://router.huggingface.co (the new unified router).
 * The old https://api-inference.huggingface.co is no longer supported.
 *
 * - Chat / Vision / Quiz / Summarize  → HF Router OpenAI-compatible endpoint
 * - Embeddings                        → HF Router OpenAI-compatible endpoint (text-embedding)
 * - Speech-to-Text                    → HF Router OpenAI-compatible endpoint (audio/transcriptions)
 * - Text-to-Speech                    → HF Router OpenAI-compatible endpoint (audio/speech)
 * - Image generation                  → OpenAI (if key set) or Pollinations fallback
 */

import OpenAI from "openai";

const HF_TOKEN = process.env.HF_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ── HF Router client (OpenAI-compatible) ──────────────────────────────────────
const hf = HF_TOKEN
  ? new OpenAI({
      baseURL: "https://router.huggingface.co/v1",
      apiKey: HF_TOKEN,
    })
  : null;

// ── Native OpenAI client (optional, for gpt-image-1) ─────────────────────────
const openai = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

const groq = GROQ_API_KEY
  ? new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: GROQ_API_KEY,
    })
  : null;

// ── Model presets (all overridable via .env) ──────────────────────────────────
export const MODEL_PRESETS = {
  chat:        process.env.HF_CHAT_MODEL      || "Qwen/Qwen3-235B-A22B:novita",
  groqChat:    process.env.GROQ_CHAT_MODEL    || "openai/gpt-oss-120b",
  openaiChat:  process.env.OPENAI_CHAT_MODEL  || "gpt-4o-mini",
  geminiChat:  process.env.GEMINI_CHAT_MODEL  || "gemini-2.0-flash-lite",
  geminiBackupChat: process.env.GEMINI_BACKUP_CHAT_MODEL || "gemini-2.0-flash",
  vision:      process.env.HF_VISION_MODEL    || "Qwen/Qwen2.5-VL-7B-Instruct",
  embeddings:  process.env.HF_EMBEDDING_MODEL || "sentence-transformers/all-MiniLM-L6-v2",
  stt:         process.env.HF_STT_MODEL       || "openai/whisper-large-v3-turbo",
  tts:         process.env.HF_TTS_MODEL       || "hexgrad/Kokoro-82M",
  imageGen:    process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
};

function ensureHF() {
  if (!hf) throw new Error("HF_TOKEN is missing in backend/.env");
}

function isQuotaErrorMessage(message = "") {
  return /402|monthly included credits|depleted your monthly included credits|purchase pre-paid credits|subscribe to pro|get 20x more included usage|billing hard limit|insufficient quota/i.test(
    String(message),
  );
}

async function requestGeminiChat({
  model,
  messages,
  temperature = 0.3,
  maxTokens = 1200,
}) {
  const systemInstruction = messages
    .filter((item) => item?.role === "system" && item?.content)
    .map((item) => item.content)
    .join("\n\n");

  const contents = messages
    .filter((item) => item?.role !== "system" && item?.content)
    .map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: String(item.content) }],
    }));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: systemInstruction
          ? { parts: [{ text: systemInstruction }] }
          : undefined,
        contents,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      }),
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message ||
      `${response.status} ${response.statusText || "Gemini request failed."}`;

    throw new Error(message);
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || "")
    .join("")
    .trim();

  return text || "";
}

async function requestGeminiVision({
  model,
  question,
  imageUrl,
  context = "",
  maxTokens = 900,
}) {
  const remote = await fetch(imageUrl);
  if (!remote.ok) {
    throw new Error(`Gemini image fetch failed with ${remote.status}`);
  }

  const mimeType = remote.headers.get("content-type") || "image/jpeg";
  const imageBuffer = Buffer.from(await remote.arrayBuffer());
  const inlineData = imageBuffer.toString("base64");
  const prompt = context
    ? `Study context:\n${context}\n\nQuestion:\n${question}`
    : question;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: inlineData,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: maxTokens,
        },
      }),
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message ||
      `${response.status} ${response.statusText || "Gemini vision request failed."}`;

    throw new Error(message);
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || "")
    .join("")
    .trim();

  return text || "";
}

async function chatCompletionWithGemini({
  messages,
  temperature = 0.3,
  maxTokens = 1200,
}) {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini fallback is not configured correctly. Please update the API key.");
  }

  try {
    return await requestGeminiChat({
      model: MODEL_PRESETS.geminiChat,
      messages,
      temperature,
      maxTokens,
    });
  } catch (error) {
    const message = String(error?.message || "");

    if (/api key not valid|invalid api key|permission denied|unauthenticated|401|403/i.test(message)) {
      throw new Error("Gemini fallback is not configured correctly. Please update the API key.");
    }

    if (/quota|rate limit|resource has been exhausted|429/i.test(message)) {
      try {
        return await requestGeminiChat({
          model: MODEL_PRESETS.geminiBackupChat,
          messages,
          temperature,
          maxTokens,
        });
      } catch (backupError) {
        const backupMessage = String(backupError?.message || "");
        if (/quota|rate limit|resource has been exhausted|429/i.test(backupMessage)) {
          throw new Error("Gemini fallback is busy or out of quota. Please wait a minute and try again.");
        }
        throw backupError;
      }
    }

    throw error;
  }
}

async function chatCompletionWithOpenAI({
  messages,
  temperature = 0.3,
  maxTokens = 1200,
}) {
  if (!openai) {
    return chatCompletionWithGemini({ messages, temperature, maxTokens });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_PRESETS.openaiChat,
      messages,
      temperature,
      max_tokens: maxTokens,
    });

    return completion.choices?.[0]?.message?.content?.trim() ?? "";
  } catch (error) {
    const message = String(error?.message || "");

    if (/401|incorrect api key provided|invalid api key/i.test(message)) {
      return chatCompletionWithGemini({ messages, temperature, maxTokens });
    }

    if (/429|rate limit|quota/i.test(message)) {
      return chatCompletionWithGemini({ messages, temperature, maxTokens });
    }

    throw error;
  }
}

async function chatCompletionWithGroq({
  messages,
  temperature = 0.3,
  maxTokens = 1200,
}) {
  if (!groq) {
    return chatCompletionWithGemini({ messages, temperature, maxTokens });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL_PRESETS.groqChat,
      messages,
      temperature,
      max_tokens: maxTokens,
    });

    return completion.choices?.[0]?.message?.content?.trim() ?? "";
  } catch (error) {
    const message = String(error?.message || "");

    if (/401|incorrect api key provided|invalid api key/i.test(message)) {
      throw new Error("Groq fallback is not configured correctly. Please update the API key.");
    }

    if (/429|rate limit|quota|resource exhausted/i.test(message)) {
      return chatCompletionWithGemini({ messages, temperature, maxTokens });
    }

    throw error;
  }
}

// ── 1. CHAT COMPLETION ────────────────────────────────────────────────────────
export async function chatCompletion({
  messages,
  model = MODEL_PRESETS.chat,
  temperature = 0.3,
  maxTokens = 1200,
}) {
  if (!hf) {
    return chatCompletionWithGroq({ messages, temperature, maxTokens });
  }

  ensureHF();
  try {
    const completion = await hf.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    });
    return completion.choices?.[0]?.message?.content?.trim() ?? "";
  } catch (error) {
    const message = String(error?.message || "");

    if (/429|rate limit|too many requests|status code \(no body\)/i.test(message)) {
      throw new Error("The AI model is busy right now. Please try again in a few seconds.");
    }

    if (isQuotaErrorMessage(message)) {
      return chatCompletionWithGroq({ messages, temperature, maxTokens });
    }

    throw error;
  }
}

// ── 2. VISION COMPLETION ──────────────────────────────────────────────────────
export async function visionCompletion({ question, imageUrl, context = "" }) {
  const systemText = context
    ? `You are an educational visual tutor. Answer using the image and the study context below.\n\nStudy context:\n${context}`
    : "You are an educational visual tutor. Inspect the image carefully and answer the student.";

  if (hf) {
    try {
      const completion = await hf.chat.completions.create({
        model: MODEL_PRESETS.vision,
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          { role: "system", content: systemText },
          {
            role: "user",
            content: [
              { type: "text", text: question },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      });
      return completion.choices?.[0]?.message?.content?.trim() ?? "";
    } catch (error) {
      const message = String(error?.message || "");
      if (!/not supported by any provider|quota|rate limit|402|429|vision/i.test(message)) {
        throw error;
      }
    }
  }

  if (openai) {
    try {
      const completion = await openai.chat.completions.create({
        model: MODEL_PRESETS.openaiChat,
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          { role: "system", content: systemText },
          {
            role: "user",
            content: [
              { type: "text", text: question },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      });
      return completion.choices?.[0]?.message?.content?.trim() ?? "";
    } catch (_error) {
      // Fall through to Gemini.
    }
  }

  if (GEMINI_API_KEY) {
    try {
      return await requestGeminiVision({
        model: MODEL_PRESETS.geminiChat,
        question,
        imageUrl,
        context,
      });
    } catch (_error) {
      // Fall through to a friendly failure below.
    }
  }

  throw new Error("That analysis model is unavailable right now. Please try a simpler text-based question or upload a clearer text image.");
}

// ── 3. IMAGE TEXT EXTRACTION (OCR-style via vision) ───────────────────────────
export async function extractImageText(imageUrl) {
  if (typeof imageUrl !== "string") return "";
  ensureHF();
  const completion = await hf.chat.completions.create({
    model: MODEL_PRESETS.vision,
    temperature: 0,
    max_tokens: 1200,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract all readable text from this image. Preserve structure, headings, bullet points, formulas, and code.",
          },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });
  return completion.choices?.[0]?.message?.content?.trim() ?? "";
}

// ── 4. EMBEDDINGS (via HF Router text-embedding endpoint) ─────────────────────
export async function embedTexts(texts) {
  ensureHF();
  // HF Router exposes embeddings at /v1/embeddings — same as OpenAI SDK
  const results = await Promise.all(
    texts.map(async (text) => {
      const response = await hf.embeddings.create({
        model: MODEL_PRESETS.embeddings,
        input: text,
      });
      return response.data?.[0]?.embedding ?? [];
    })
  );
  return results;
}

// ── 5. SUMMARIZE ──────────────────────────────────────────────────────────────
export async function summarizeText(text) {
  return chatCompletion({
    messages: [
      {
        role: "system",
        content:
          "You are a study companion. Produce a crisp student-friendly summary with key ideas, formulas, and likely exam focus areas.",
      },
      { role: "user", content: `Summarize this study content:\n\n${text}` },
    ],
    maxTokens: 700,
  });
}

// ── 6. QUIZ GENERATION ────────────────────────────────────────────────────────
function extractJsonBlock(raw) {
  const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error("Model did not return valid JSON for quiz.");
  return JSON.parse(match[0]);
}

export async function generateQuiz({ sourceText, title, difficulty, count }) {
  const raw = await chatCompletion({
    messages: [
      {
        role: "system",
        content: "You create accurate educational quizzes. Return valid JSON only.",
      },
      {
        role: "user",
        content: `Create a ${difficulty} quiz with ${count} multiple-choice questions for the topic "${title}".

Return JSON in this exact shape:
{
  "title": "string",
  "questions": [
    {
      "question": "string",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A. ...",
      "explanation": "string"
    }
  ]
}

Study material:
${sourceText.slice(0, 15000)}`,
      },
    ],
    temperature: 0.2,
    maxTokens: 1400,
  });
  return extractJsonBlock(raw);
}

// ── 7. SPEECH-TO-TEXT (Whisper via HF Router audio/transcriptions) ────────────
export async function transcribeAudio(buffer, mimeType = "audio/webm") {
  ensureHF();

  // HF Router supports the OpenAI audio transcription endpoint
  const blob = new Blob([buffer], { type: mimeType });
  const file = new File([blob], "speech.webm", { type: mimeType });

  const transcription = await hf.audio.transcriptions.create({
    model: MODEL_PRESETS.stt,
    file,
  });

  return typeof transcription === "string"
    ? transcription
    : (transcription.text ?? "");
}

// ── 8. TEXT-TO-SPEECH (Kokoro via HF Router audio/speech) ─────────────────────
export async function speakText(text) {
  ensureHF();

  // HF Router supports the OpenAI audio speech endpoint
  const response = await hf.audio.speech.create({
    model: MODEL_PRESETS.tts,
    input: text.slice(0, 4096),
    voice: "af_heart",   // Kokoro voice id — change as desired
  });

  return Buffer.from(await response.arrayBuffer());
}

// ── 9. IMAGE GENERATION ───────────────────────────────────────────────────────

function isEducationalPosterPrompt(prompt = "") {
  return /(plan|roadmap|mind ?map|flowchart|diagram|study|notes|syllabus|learning path|poster|infographic)/i.test(prompt);
}

async function buildImageGenerationPrompt(prompt, conversationContext = "") {
  const rewritten = await chatCompletion({
    messages: [
      {
        role: "system",
        content:
          "Convert user requests into precise image-generation prompts. Preserve the exact subject and intent. Use recent conversation context only when it clearly helps resolve what the user wants. Do not drift away from the user's latest request. Return one prompt only.",
      },
      {
        role: "user",
        content: conversationContext
          ? `Recent conversation context:\n${conversationContext}\n\nLatest user request:\n${prompt}\n\nRewrite the latest request into one precise image prompt that fits the context.`
          : `Rewrite into a precise image prompt:\n${prompt}`,
      },
    ],
    temperature: 0.2,
    maxTokens: 220,
  });
  return rewritten.replace(/^["']|["']$/g, "").trim() || prompt;
}

async function buildEditedImagePrompt({ instruction, imageUrl }) {
  try {
    const prompt = await visionCompletion({
      question: `You are helping an image generation model edit a reference image.
User edit request: ${instruction}
Return ONE detailed generation prompt only. Keep same subject/framing/composition unless explicitly changed. No explanation.`,
      imageUrl,
    });
    return prompt.replace(/^["']|["']$/g, "").trim();
  } catch (_error) {
    return `Use the uploaded image as the main visual reference. Keep the same subject, framing, and overall composition unless the user clearly asks to change them. User request: ${instruction}`;
  }
}

function enforceSceneAccuracy(prompt) {
  const lower = prompt.toLowerCase();
  if (/(salon|barber|hair studio)/i.test(lower)) {
    return `${prompt}, wide interior scene, styling chairs, mirrors, haircut stations, barber tools, realistic environment`;
  }
  if (/(shop|store|restaurant|classroom|office|library|room|building)/i.test(lower)) {
    return `${prompt}, wide establishing shot, realistic environment, full location visible`;
  }
  return prompt;
}

// SVG poster generator (no external API needed)
async function generatePosterSpec(prompt) {
  const raw = await chatCompletion({
    messages: [
      {
        role: "system",
        content: "You create clean study posters. Return valid JSON only.",
      },
      {
        role: "user",
        content: `Create a concise educational poster specification for: "${prompt}".
Return JSON:
{
  "title": "short title",
  "subtitle": "one helpful subtitle",
  "sections": [{"heading": "...", "points": ["...", "..."]}]
}
Rules: 4-6 sections, 2-3 short points each, student-friendly.`,
      },
    ],
    temperature: 0.2,
    maxTokens: 900,
  });
  return extractJsonBlock(raw);
}

function escapeSvg(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapSvgText(text = "", maxChars = 28) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) { if (current) lines.push(current); current = word; }
    else current = next;
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function createPosterSvg(spec) {
  const width = 1200, height = 900;
  const sections = (spec.sections || []).slice(0, 6);
  const cardW = 340, cardH = 190;
  const positions = [[80,220],[430,220],[780,220],[80,430],[430,430],[780,430]];

  const cards = sections.map((sec, i) => {
    const [x, y] = positions[i] || [80, 220 + i * 200];
    const heading = escapeSvg(sec.heading || `Step ${i+1}`);
    const points = (sec.points || []).slice(0, 3);
    const textMarkup = points.flatMap((pt, pi) =>
      wrapSvgText(pt, 28).map((line, li) =>
        `<text x="${x+24}" y="${y+72+pi*38+li*18}" font-size="20" fill="#CFE6FF" font-family="Segoe UI,Arial,sans-serif">• ${escapeSvg(line)}</text>`
      )
    ).join("");
    return `<g>
      <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="26" fill="rgba(15,24,42,0.82)" stroke="rgba(98,200,255,0.35)" stroke-width="2"/>
      <text x="${x+24}" y="${y+42}" font-size="26" font-weight="700" fill="#F2F7FF" font-family="Segoe UI,Arial,sans-serif">${heading}</text>
      ${textMarkup}
    </g>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#081120"/><stop offset="55%" stop-color="#0D1830"/><stop offset="100%" stop-color="#13233E"/>
    </linearGradient>
    <linearGradient id="ac" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#5EC9FF"/><stop offset="100%" stop-color="#96E6FF"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <circle cx="1030" cy="110" r="180" fill="rgba(94,201,255,0.12)"/>
  <circle cx="170" cy="760" r="220" fill="rgba(94,201,255,0.08)"/>
  <text x="80" y="92" font-size="52" font-weight="800" fill="#F4F8FF" font-family="Segoe UI,Arial,sans-serif">${escapeSvg(spec.title||"Study Poster")}</text>
  <text x="80" y="138" font-size="24" fill="url(#ac)" font-family="Segoe UI,Arial,sans-serif">${escapeSvg(spec.subtitle||"")}</text>
  ${cards}
</svg>`;
}

async function fetchImageBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Image provider failed with ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function tryPollinationsVariants(prompt) {
  const encoded = encodeURIComponent(`high quality, sharp focus, realistic: ${prompt}`);
  const variants = [
    `https://image.pollinations.ai/prompt/${encoded}?model=flux&width=1024&height=1024&nologo=true&safe=true&enhance=true`,
    `https://image.pollinations.ai/prompt/${encoded}?model=turbo&width=1024&height=1024&nologo=true&safe=true`,
    `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&safe=true`,
    `https://image.pollinations.ai/prompt/${encoded}?model=flux&width=768&height=768&nologo=true&safe=true`,
  ];

  let lastError = null;

  for (const url of variants) {
    try {
      const buffer = await fetchImageBuffer(url);
      return { buffer, mimeType: "image/png", extension: "png" };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Pollinations image generation failed.");
}

export async function generateImageFromPrompt(prompt, options = {}) {
  const { referenceImageUrl, conversationContext = "" } = options;

  // Educational posters → SVG (no API cost)
  if (!referenceImageUrl && isEducationalPosterPrompt(prompt)) {
    const spec = await generatePosterSpec(prompt);
    return { buffer: Buffer.from(createPosterSvg(spec)), mimeType: "image/svg+xml", extension: "svg" };
  }

  // Build the final prompt
  const finalPrompt = referenceImageUrl
    ? await buildEditedImagePrompt({ instruction: prompt, imageUrl: referenceImageUrl })
    : enforceSceneAccuracy(await buildImageGenerationPrompt(prompt, conversationContext));

  // Try OpenAI gpt-image-1 first, but fall back automatically if billing/limits fail.
  if (openai) {
    try {
      const response = await openai.images.generate({
        model: MODEL_PRESETS.imageGen,
        prompt: `high quality, sharp focus, realistic details, clean composition, exact subject match: ${finalPrompt}`,
        size: "1024x1024",
      });
      const image = response.data?.[0];
      if (image?.b64_json) {
        return { buffer: Buffer.from(image.b64_json, "base64"), mimeType: "image/png", extension: "png" };
      }
      if (image?.url) {
        const remote = await fetch(image.url);
        if (!remote.ok) throw new Error(`OpenAI image URL fetch failed ${remote.status}`);
        return { buffer: Buffer.from(await remote.arrayBuffer()), mimeType: "image/png", extension: "png" };
      }
    } catch (_error) {
      // Fall through to the free fallback below.
    }
  }

  // Fallback → Pollinations (free, no key needed)
  return tryPollinationsVariants(finalPrompt);
}

export function isImageGenerationPrompt(prompt = "") {
  const normalized = prompt.trim().toLowerCase();
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
