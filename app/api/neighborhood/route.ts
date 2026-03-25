import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getNeighborhoodProfile } from "@/lib/neighborhood-service";

// Vercel: 30s max za zunanji Overpass + ARSO klic
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const schema = z.object({
  lat: z.coerce.number().min(45).max(47),
  lng: z.coerce.number().min(13).max(17),
});

export async function GET(req: NextRequest) {
  const parsed = schema.safeParse({
    lat: req.nextUrl.searchParams.get("lat"),
    lng: req.nextUrl.searchParams.get("lng"),
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  try {
    const profile = await getNeighborhoodProfile(parsed.data.lat, parsed.data.lng);
    return NextResponse.json(profile);
  } catch (err) {
    console.error("[neighborhood] error:", err);
    return NextResponse.json({
      lat: parsed.data.lat, lng: parsed.data.lng,
      noiseLdenDb: null, noiseLabel: null,
      statOkolisId: null, statOkolisName: null,
      ageAvg: null, ageU30Pct: null, age3065Pct: null, ageO65Pct: null,
      eduTertiaryPct: null, popTotal: null,
      amenity: null, pricePerM2_500m: null,
      characterTags: [], neighborhoodType: null,
      _error: "timeout",
    });
  }
}
