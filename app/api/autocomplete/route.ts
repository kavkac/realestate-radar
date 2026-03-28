import { NextRequest, NextResponse } from "next/server";

const CORS = {
  "Access-Control-Allow-Origin": "https://rer-pipeline.vercel.app",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("input") ?? "";
  if (!input || input.length < 2) {
    return NextResponse.json({ predictions: [] }, { headers: CORS });
  }

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:si&language=sl&types=address&key=${key}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    return NextResponse.json(
      { predictions: data.predictions ?? [] },
      { headers: CORS }
    );
  } catch {
    return NextResponse.json({ predictions: [] }, { headers: CORS });
  }
}
