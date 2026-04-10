import { Router } from "express";
import { resolveEmailIntent, sendAnswerEmail } from "../controllers/email.controller.js";

const router = Router();

router.post("/send", sendAnswerEmail);
router.post("/resolve-intent", resolveEmailIntent);

export default router;
