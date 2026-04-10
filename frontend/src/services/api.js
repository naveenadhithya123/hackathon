const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const raw = await response.text();
  let data = {};

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { error: raw };
    }
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
        data.message ||
        `${response.status} ${response.statusText || "Request failed."}`,
    );
  }

  return data;
}

export function sendChatMessage(payload) {
  return request("/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getHistory(userId) {
  return request(`/chat/${userId}/history`);
}

export function buildDocumentDownloadUrl(fileUrl, filename = "download") {
  const params = new URLSearchParams({
    url: fileUrl || "",
    filename,
  });

  return `${API_URL}/documents/download?${params.toString()}`;
}

export async function uploadDocumentFile(file, userId) {
  const formData = new FormData();
  formData.append("file", file);
  if (userId) {
    formData.append("userId", userId);
  }

  try {
    const response = await fetch(`${API_URL}/documents/upload`, {
      method: "POST",
      body: formData,
    });

    const raw = await response.text();
    let data = {};

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { error: raw };
      }
    }

    if (!response.ok) {
      throw new Error(data.error || "Document upload failed.");
    }

    return data;
  } catch (error) {
    if (/Failed to fetch/i.test(String(error?.message || ""))) {
      throw new Error("Could not reach the document upload service. Check that the backend is running and try again.");
    }

    throw error;
  }
}

export async function uploadImageFile(file) {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch(`${API_URL}/images/upload`, {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Image upload failed.");
  }

  return data;
}

export function generateImage(prompt) {
  return request("/images/generate", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
}

export function generateQuiz(payload) {
  return request("/quizzes/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function buildAudioFilename(audioBlob) {
  const mimeType = String(audioBlob?.type || "").toLowerCase();

  if (mimeType.includes("mp4") || mimeType.includes("mpeg")) {
    return "speech.m4a";
  }

  if (mimeType.includes("ogg")) {
    return "speech.ogg";
  }

  if (mimeType.includes("wav")) {
    return "speech.wav";
  }

  return "speech.webm";
}

export async function transcribeAudio(audioBlob) {
  const formData = new FormData();
  formData.append("audio", audioBlob, buildAudioFilename(audioBlob));

  const response = await fetch(`${API_URL}/speech/transcribe`, {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Transcription failed.");
  }

  return data;
}

export function requestSpeech(text) {
  return request("/speech/speak", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function sendAnswerEmail(payload) {
  return request("/email/send", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resolveEmailIntent(payload) {
  return request("/email/resolve-intent", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function bootstrapProfile(payload) {
  return request("/auth/bootstrap", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
