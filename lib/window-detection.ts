/**
 * Window detection via Gemini Vision
 * Estimates window-to-wall ratio from facade images.
 * Uses Gemini 1.5 Flash (free tier: 15 req/min, 1M tokens/day)
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
 */
async function analyzeImage(
  imageUrl: string,
): Promise<{ ratio: number; confidence: string } | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[window-detection] GEMINI_API_KEY not set");
    return null;
  }

  const body = {
    contents: [
      {
        parts: [
          { text: GEMINI_PROMPT },
          { inline_data: undefined as unknown },
          {
            image_url: undefined as unknown,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
  };

  // Use image URL directly (Gemini supports public URLs via parts)
  const payload = {
    contents: [
      {
        parts: [
          { text: GEMINI_PROMPT },
          {
            fileData: {
              mimeType: "image/jpeg",
              fileUri: imageUrl,
            },
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
  };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      console.error("[window-detection] Gemini error", res.status, await res.text());
      return null;
    }

    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Parse JSON from response
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]);
    const ratio = parseFloat(parsed.window_ratio);
    if (isNaN(ratio) || ratio < 0 || ratio > 1) return null;

    return { ratio, confidence: parsed.confidence ?? "medium" };
  } catch (e) {
    console.error("[window-detection] error", e);
    return null;
  }
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
