# 🎓 Edu AI Portal — Full Setup Guide

## What was fixed

### 🔴 Critical bug fixed
`https://api-inference.huggingface.co` is deprecated and no longer supported.
**All HF calls now go through `https://router.huggingface.co/v1`** via the OpenAI-compatible SDK.

This fixes:
- Chat not working
- Document reading failing
- Speech-to-text failing
- Text-to-speech failing
- Embeddings failing

---

## Project structure

```
hackathon/
├── backend/
│   ├── src/
│   │   ├── controllers/      (auth, chat, document, email, image, quiz, speech)
│   │   ├── middleware/       (auth, rateLimit, upload)
│   │   ├── routes/           (all routes)
│   │   ├── services/
│   │   │   ├── huggingface.service.js  ← FIXED (router.huggingface.co)
│   │   │   ├── supabase.service.js
│   │   │   ├── cloudinary.service.js
│   │   │   ├── brevo.service.js
│   │   │   └── ocr.service.js
│   │   ├── utils/            (pdfParser, pdfGenerator, promptBuilder, textChunks)
│   │   └── app.js
│   ├── .env                  ← copy from .env.example and fill
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Auth/         (Login.jsx, Signup.jsx)
│   │   │   └── Chat/         (ChatWindow, InputBar, MessageBubble, SidebarHistory, TypingIndicator)
│   │   ├── hooks/            (useChat, useFileUpload, useSpeech)
│   │   ├── services/         (api.js, supabase.js, cloudinary.js)
│   │   ├── store/            (chatStore.js)
│   │   ├── App.jsx           ← IMPROVED
│   │   ├── index.css         ← IMPROVED
│   │   ├── welcome.css       ← NEW
│   │   └── main.jsx          ← UPDATED
│   ├── .env                  ← copy from .env.example and fill
│   └── package.json
│
└── supabase/
    └── schema.sql
```

---

## Step 1 — Backend setup

```bash
cd backend
cp .env.example .env
# Fill in your keys in .env
npm install
npm run dev
```

### Required keys in `backend/.env`

| Key | Where to get it |
|-----|----------------|
| `HF_TOKEN` | huggingface.co → Settings → Access Tokens |
| `SUPABASE_URL` | supabase.com → Project Settings → API |
| `SUPABASE_ANON_KEY` | supabase.com → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | supabase.com → Project Settings → API |
| `CLOUDINARY_CLOUD_NAME` | cloudinary.com → Dashboard |
| `CLOUDINARY_API_KEY` | cloudinary.com → Dashboard |
| `CLOUDINARY_API_SECRET` | cloudinary.com → Dashboard |
| `BREVO_API_KEY` | brevo.com → SMTP & API → API Keys |
| `BREVO_SENDER_EMAIL` | your verified sender email in Brevo |
| `OPENAI_API_KEY` | (optional) platform.openai.com — only needed for gpt-image-1 |

> **Image generation without OpenAI key:** Falls back to Pollinations.ai (free, no key needed).

---

## Step 2 — Supabase database

1. Go to your Supabase project → SQL Editor
2. Run the entire contents of `supabase/schema.sql`
3. This creates: `profiles`, `chats`, `messages`, `documents`, `document_chunks`, `quizzes` tables + vector search function

---

## Step 3 — Frontend setup

```bash
cd frontend
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

### Required keys in `frontend/.env`

```
VITE_APP_NAME=Edu AI Tutor
VITE_API_URL=http://localhost:4000/api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_ENABLE_AUTH=true
```

---

## Features & how to use them

| Feature | How |
|---------|-----|
| **Chat** | Just type and send |
| **Document Q&A** | Click `+` → upload PDF/TXT → ask questions about it |
| **Image Q&A** | Click `+` → upload image → ask "what is in this image?" |
| **Voice input** | Click the mic button → speak → click again to stop |
| **Text-to-speech** | Click "Read aloud" under any AI message |
| **Quiz generation** | Type `/quiz` after uploading a document |
| **Image generation** | Say "generate an image of..." or switch to Images folder |
| **Email answer** | Type `/email you@example.com` or "send this to email@x.com" |
| **Chat history** | All chats saved to Supabase, visible in left sidebar |

---

## Models used (all via HF Router)

| Task | Model |
|------|-------|
| Chat / Reasoning | `Qwen/Qwen3-235B-A22B:novita` |
| Vision / Image Q&A | `Qwen/Qwen2.5-VL-7B-Instruct` |
| Speech to Text | `openai/whisper-large-v3-turbo` |
| Text to Speech | `hexgrad/Kokoro-82M` |
| Embeddings | `sentence-transformers/all-MiniLM-L6-v2` |
| Image Generation | `gpt-image-1` (OpenAI) or Pollinations fallback |

---

## Render deployment

This repo includes a `render.yaml` file for a 2-service Render setup:

- `abc-ai-backend` as a Node web service
- `abc-ai-frontend` as a static site

High-level deploy flow:

1. Push this repo to GitHub.
2. In Render, click `New +` -> `Blueprint`.
3. Connect the GitHub repo and select this repository.
4. Render will read `render.yaml` and create both services.
5. Add the required secret environment variables on the backend and frontend.
6. Set `VITE_API_URL` on the frontend to your backend URL plus `/api`.
7. Set `CLIENT_URL` on the backend to your frontend URL.
8. Redeploy both services after saving the environment variables.
