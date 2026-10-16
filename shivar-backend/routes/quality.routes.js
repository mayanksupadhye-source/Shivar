
const express = require("express");
const multer = require("multer");
const { GoogleGenAI } = require("@google/genai");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Use JPG, PNG or WebP images"));
    }
    cb(null, true);
  }
});

router.post("/analyze", upload.array("images", 5), async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API key is missing" });
    }

    const { cropType } = req.body;

    if (!cropType || !req.files?.length) {
      return res.status(400).json({
        error: "Crop type and at least one photo are required"
      });
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });

    const parts = [
      {
        text: `Assess visible quality of ${cropType} in these images.
Return JSON with fields: cropType, visualGrade, estimatedVisualScore,
observations, visibleDefects, recommendations, limitations,
needsHumanInspection.
Use a 0-100 score only if evidence is sufficient; otherwise null.
Do not claim to verify pesticide residue, internal moisture, hidden
defects or official MSP/government grade. This is a visual estimate,
not a certified grade.`
      },
      ...req.files.map(file => ({
        inlineData: {
          mimeType: file.mimetype,
          data: file.buffer.toString("base64")
        }
      }))
    ];

    const result = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: [{ parts }],
      config: { responseMimeType: "application/json" }
    });

    let assessment;
    try {
      assessment = JSON.parse(result.text);
    } catch {
      return res.status(502).json({ error: "Invalid AI response" });
    }

    res.json({
      success: true,
      assessment,
      disclaimer: "Visual estimate only, not an official grade."
    });
  } catch (error) {
    console.error("Crop quality API:", error.message);
    res.status(500).json({ error: "AI crop analysis failed" });
  }
});

module.exports = router;
