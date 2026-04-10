import { Router } from "express";
import {
  createChatShareLink,
  getChatHistory,
  getSharedChat,
  sendMessage,
} from "../controllers/chat.controller.js";

const router = Router();

router.post("/", sendMessage);
router.post("/:chatId/share", createChatShareLink);
router.get("/shared/:token", getSharedChat);
router.get("/:userId/history", getChatHistory);

export default router;
