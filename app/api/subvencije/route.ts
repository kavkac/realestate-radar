import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { matchSubvencije, Subvencija } from "@/lib/subvencije";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const letoGradnje = sp.get("letoGradnje") ? parseInt(sp.get("letoGradnje")!) : null;
  const energijskiRazred = sp.get("energijskiRazred") ?? null;
  const tipStavbe = (sp.get("tipStavbe") ?? "stanovanje") as "stanovanje" | "stavba" | "parcela";

  const all = await prisma.$queryRawUnsafe<Subvencija[]>(
    `SELECT id, naziv, kratek_opis, vir, tip, namen, max_znesek, max_delez, url, pogoji
     FROM subvencije WHERE aktivna = true ORDER BY vir, tip`
  );

  const matched = matchSubvencije(all, { letoGradnje, energijskiRazred, tipStavbe });
  return NextResponse.json({ subvencije: matched });
}
