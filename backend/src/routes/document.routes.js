import { Router } from "express";
import { downloadDocument, uploadDocument } from "../controllers/document.controller.js";
import { upload } from "../middleware/upload.middleware.js";

const router = Router();

router.post("/upload", upload.single("file"), uploadDocument);
router.get("/download", downloadDocument);

export default router;
