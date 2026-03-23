/**
 * Window detection via Vision API
 * Estimates window-to-wall ratio from facade images.
 *
 * Provider priority (first available key wins):
 *   1. OPENAI_API_KEY  → GPT-4o mini (cheapest, ~$0.00015/image)
 *   2. ANTHROPIC_API_KEY → Claude 3.5 Haiku
 *   3. GEMINI_API_KEY  → Gemini 1.5 Flash (free tier fallback)
 *
 * Returns:
 *   windowRatio: 0.0-1.0 (fraction of facade that is windows)
 *   confidence: "high" | "medium" | "low"
 *   source: "mapillary_ml"
 */

export interface WindowDetectionResult {
  windowRatio: number;       // 0.0 - 1.0
  confidence: "high" | "medium" | "low";
  imageCount: number;
  source: "mapillary_ml";
  rawEstimates: number[];    // per-image estimates
}

const GEMINI_PROMPT = `You are a building energy analyst. Analyze this street-level photo.

Task: Estimate the window-to-wall ratio visible on the main building facade.
- Window-to-wall ratio = total window area / total opaque wall area (excluding roof, ground, sky)
- Focus on the PRIMARY building facade facing the camera
- Ignore doors (count as wall area)
- Ignore balcony railings/glass (count only window panes)

Typical values by building era:
- Pre-1945 (old town): 0.15-0.25
- 1945-1970 (socialist blocks): 0.20-0.35
- 1971-1990 (panel construction): 0.25-0.40
- 1991-2010 (modern): 0.30-0.45
- Post-2010 (contemporary): 0.35-0.60

Respond ONLY with a JSON object, no explanation:
{
  "window_ratio": <number 0.0-1.0>,
  "confidence": "<high|medium|low>",
  "reason": "<one sentence why>"
}

confidence=high: clear facade view, good image quality
confidence=medium: partial occlusion (trees, cars) or oblique angle
confidence=low: image unclear, building not main subject, or facade not visible`;

/**
 * Analyze a single facade image for window ratio.
 * imageUrl: publicly accessible URL (Mapillary thumb URL)
 *
 * Provider cascade: OpenAI → Claude → Gemini
 */
async function analyzeImage(
  imageUrl: string,
): Promise<{ ratio: number; confidence: string } | null> {
  // 1. OpenAI GPT-4o mini (preferred — cheapest vision model)
  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 200,
          temperature: 0.1,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: GEMINI_PROMPT },
              { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
            ],
          }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const json = await res.json();
        const text = json.choices?.[0]?.message?.content ?? "";
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          const ratio = parseFloat(parsed.window_ratio);
          if (!isNaN(ratio) && ratio >= 0 && ratio <= 1) {
            return { ratio, confidence: parsed.confidence ?? "medium" };
          }
        }
      }
    } catch { /* fall through */ }
  }

  // 2. Claude 3.5 Haiku
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 200,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: GEMINI_PROMPT },
              { type: "image", source: { type: "url", url: imageUrl } },
            ],
          }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const json = await res.json();
        const text = json.content?.[0]?.text ?? "";
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          const ratio = parseFloat(parsed.window_ratio);
          if (!isNaN(ratio) && ratio >= 0 && ratio <= 1) {
            return { ratio, confidence: parsed.confidence ?? "medium" };
          }
        }
      }
    } catch { /* fall through */ }
  }

  // 3. Gemini 1.5 Flash (fallback)
  if (process.env.GEMINI_API_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { text: GEMINI_PROMPT },
              { fileData: { mimeType: "image/jpeg", fileUri: imageUrl } },
            ]}],
            generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (res.ok) {
        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          const ratio = parseFloat(parsed.window_ratio);
          if (!isNaN(ratio) && ratio >= 0 && ratio <= 1) {
            return { ratio, confidence: parsed.confidence ?? "medium" };
          }
        }
      }
    } catch { /* exhausted */ }
  }

  console.warn("[window-detection] No vision API key available or all failed");
  return null;
}

/**
 * Estimate window-to-wall ratio from multiple facade images.
 * Aggregates per-image estimates, weighted by confidence.
 */
export async function estimateWindowRatio(
  imageUrls: string[],
): Promise<WindowDetectionResult | null> {
  if (!imageUrls.length) return null;

  const confidenceWeights: Record<string, number> = {
    high: 1.0,
    medium: 0.6,
    low: 0.2,
  };

  const results = await Promise.all(imageUrls.map(analyzeImage));
  const valid = results.filter((r): r is NonNullable<typeof r> => r !== null);

  if (!valid.length) return null;

  // Weighted average
  let weightedSum = 0;
  let totalWeight = 0;
  const rawEstimates: number[] = [];

  for (const r of valid) {
    const w = confidenceWeights[r.confidence] ?? 0.5;
    weightedSum += r.ratio * w;
    totalWeight += w;
    rawEstimates.push(r.ratio);
  }

  const windowRatio = weightedSum / totalWeight;

  // Overall confidence based on image count and individual confidences
  const avgWeight = totalWeight / valid.length;
  const confidence: WindowDetectionResult["confidence"] =
    valid.length >= 3 && avgWeight >= 0.8
      ? "high"
      : valid.length >= 2 && avgWeight >= 0.5
        ? "medium"
        : "low";

  return {
    windowRatio: Math.round(windowRatio * 1000) / 1000,
    confidence,
    imageCount: valid.length,
    source: "mapillary_ml",
    rawEstimates,
  };
}
