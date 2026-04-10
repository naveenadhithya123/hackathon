function ensureBrevoConfig() {
  if (!process.env.BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY is missing in backend/.env");
  }

  if (!process.env.BREVO_SENDER_EMAIL) {
    throw new Error("BREVO_SENDER_EMAIL is missing in backend/.env");
  }
}

function mapBrevoError(message = "") {
  const normalized = String(message || "");

  if (/api key is not enabled/i.test(normalized)) {
    return "Brevo email is not configured correctly. Please use an active Brevo API key in backend/.env.";
  }

  if (/sender.*not valid|unauthorized sender|not verified/i.test(normalized)) {
    return "Brevo sender email is not verified. Please verify BREVO_SENDER_EMAIL in your Brevo account.";
  }

  if (/permission|unauthorized|forbidden/i.test(normalized)) {
    return "Brevo rejected the email request. Please check the API key permissions and sender setup.";
  }

  return normalized || "Brevo email request failed.";
}

function guessMimeType(filename = "") {
  const normalized = String(filename).toLowerCase();

  if (normalized.endsWith(".pdf")) return "application/pdf";
  if (normalized.endsWith(".txt")) return "text/plain";
  if (normalized.endsWith(".doc")) return "application/msword";
  if (normalized.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return "application/octet-stream";
}

function extractFilename(url = "", fallback = "attachment") {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split("/").pop() || fallback;
    return decodeURIComponent(lastSegment.split("?")[0]) || fallback;
  } catch (_error) {
    return fallback;
  }
}

async function fetchRemoteAttachment(file) {
  const candidateUrls = [
    file.fileUrl,
    typeof file.fileUrl === "string" && file.fileUrl.includes("/upload/")
      ? file.fileUrl.replace("/upload/", "/upload/fl_attachment/")
      : null,
  ].filter(Boolean);

  let response = null;

  for (const url of candidateUrls) {
    const currentResponse = await fetch(url);
    if (currentResponse.ok) {
      response = currentResponse;
      break;
    }
  }

  if (!response) {
    throw new Error(`Could not fetch attachment: ${file.name || file.fileUrl}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const filename = file.name || extractFilename(file.fileUrl);

  return {
    name: filename,
    content: buffer.toString("base64"),
    type: String(file.type || "").includes("/") ? file.type : guessMimeType(filename),
  };
}

async function normalizeAttachments(attachments = []) {
  const normalized = [];

  for (const attachment of attachments) {
    if (attachment?.content && attachment?.name) {
      normalized.push(attachment);
      continue;
    }

    if (attachment?.fileUrl) {
      normalized.push(await fetchRemoteAttachment(attachment));
    }
  }

  return normalized;
}

export async function sendEmail({ to, subject, html, text, attachments = [] }) {
  ensureBrevoConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const normalizedAttachments = await normalizeAttachments(attachments);
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": process.env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: {
          email: process.env.BREVO_SENDER_EMAIL,
          name: process.env.BREVO_SENDER_NAME || "Edu AI Tutor",
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
        attachment: normalizedAttachments,
      }),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(mapBrevoError(data.message || data.code || "Brevo email request failed."));
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Email request timed out. Please check Brevo configuration and try again.");
    }

    throw new Error(mapBrevoError(error.message));
  } finally {
    clearTimeout(timeout);
  }
}
