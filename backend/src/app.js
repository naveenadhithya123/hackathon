import "dotenv/config";
import cors from "cors";
import express from "express";

import authRoutes from "./routes/auth.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import documentRoutes from "./routes/document.routes.js";
import emailRoutes from "./routes/email.routes.js";
import imageRoutes from "./routes/image.routes.js";
import quizRoutes from "./routes/quiz.routes.js";
import speechRoutes from "./routes/speech.routes.js";
import { optionalAuth } from "./middleware/auth.middleware.js";
import { apiLimiter } from "./middleware/rateLimit.middleware.js";

const app = express();
const PORT = process.env.PORT || 4000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

const allowedOrigins = [
  ...new Set(
    String(CLIENT_URL)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .concat(["http://localhost:5173", "http://127.0.0.1:5173"]),
  ),
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      try {
        if (
          allowedOrigins.includes(origin) ||
          /\.onrender\.com$/i.test(new URL(origin).hostname)
        ) {
          callback(null, true);
          return;
        }
      } catch (_error) {
        // Fall through to the rejection below for malformed origins.
      }

      callback(new Error("CORS origin not allowed."));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(optionalAuth);
app.use("/api", apiLimiter);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "edu-ai-backend",
    time: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/images", imageRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/speech", speechRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const message = String(error?.message || "");
  const friendlyMessage =
    error?.code === "LIMIT_FILE_SIZE"
      ? "File size exceeds the 50 MB upload limit."
      : /1024\s*kb|1\s*mb|maximum permissible file size/i.test(message)
        ? "The file was uploaded, but OCR was skipped because the provider only accepts smaller files."
        : message || "Internal server error.";

  res.status(error.status || 500).json({
    error: friendlyMessage,
  });
});

app.listen(PORT, () => {
  console.log(`Edu AI backend running on http://localhost:${PORT}`);
});
