import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getNeighborhoodProfile } from "@/lib/neighborhood-service";

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

  const profile = await getNeighborhoodProfile(parsed.data.lat, parsed.data.lng);
  return NextResponse.json(profile);
}
