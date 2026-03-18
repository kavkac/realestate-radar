import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, phone, naslov, ponudnik, produkt, vsota, premija_min, premija_max } = body;

    const timestamp = new Date().toISOString();

    // Log for debugging
    console.log("[lead]", { email, phone, naslov, ponudnik, produkt, vsota, premija_min, premija_max, timestamp });

    // Save to lead_emails table (existing schema: id, email, naslov, createdAt)
    if (email && naslov) {
      await prisma.leadEmail.create({
        data: {
          email: String(email),
          naslov: `${naslov} | ${ponudnik ?? ""} ${produkt ?? ""} | vsota: ${vsota ?? ""} | premija: ${premija_min ?? ""}–${premija_max ?? ""} € | tel: ${phone ?? ""}`,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[lead] error:", error);
    // Return ok even on DB error — demo mode
    return NextResponse.json({ ok: true, demo: true });
  }
}
