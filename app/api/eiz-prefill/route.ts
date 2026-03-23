/**
 * GET /api/eiz-prefill?eid=<eidStavba>&lat=<lat>&lng=<lng>[&del=<eidDelStavbe>]
 *
 * Returns structured EIZ pre-fill data package for certified energy auditors.
 * ~80% of KI Expert input fields pre-populated with full data provenance.
 * Requires authentication (auditor or logged-in property owner).
 *
 * TODO: Add auth guard when auth system is in place
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateEizPrefill } from "@/lib/eiz-prefill";

const schema = z.object({
  eid: z.string().min(1),
  lat: z.coerce.number().min(45).max(47),
  lng: z.coerce.number().min(13).max(17),
  del: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = schema.safeParse(params);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid params", details: parsed.error.flatten() }, { status: 400 });
  }

  const { eid, lat, lng, del } = parsed.data;

  try {
    const report = await generateEizPrefill({
      eidStavba: eid,
      eidDelStavbe: del,
      lat,
      lng,
    });
    return NextResponse.json(report);
  } catch (e) {
    console.error("[eiz-prefill] Error:", e);
    return NextResponse.json({ error: "Prefill generation failed" }, { status: 500 });
  }
}
