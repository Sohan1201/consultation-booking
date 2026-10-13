
import { Router } from "express";
import { z } from "zod";
import { checkQuestion } from "../services/questionSafety";

const router = Router();

const questionSchema = z.object({
  question: z.string().trim().min(1).max(2000)
});

router.post("/check", (req, res) => {
  const parsed = questionSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_QUESTION",
      details: parsed.error.issues
    });
  }

  const result = checkQuestion(parsed.data.question);

  return res.status(200).json(result);
});

export default router;
