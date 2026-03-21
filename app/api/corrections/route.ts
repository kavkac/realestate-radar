import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

async function getOrCreateUser(clerkId: string) {
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `SELECT id FROM users WHERE clerk_id = $1 LIMIT 1`, clerkId
  );
  if (rows.length) return rows[0].id;
  const ins = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `INSERT INTO users (clerk_id) VALUES ($1) RETURNING id`, clerkId
  );
  return ins[0].id;
}

// GET /api/corrections?stavba_id=KO-ST
export async function GET(req: NextRequest) {
  const stavbaId = req.nextUrl.searchParams.get("stavba_id");
  if (!stavbaId) return NextResponse.json({ corrections: [] });

  const rows = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT c.atribut, c.vrednost, c.trust_level, c.created_at,
            u.verification_tier
     FROM user_corrections c
     JOIN users u ON u.id = c.user_id
     WHERE c.stavba_id = $1
     ORDER BY c.created_at DESC`,
    stavbaId
  );
  return NextResponse.json({ corrections: rows });
}

// POST /api/corrections
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    stavba_id: string;
    del_stavbe_id?: string;
    corrections: Array<{ atribut: string; vrednost: string }>;
  };

  const dbUserId = await getOrCreateUser(userId);

  // Pridobi verification_tier
  const userRows = await prisma.$queryRawUnsafe<{ verification_tier: string }[]>(
    `SELECT verification_tier FROM users WHERE id = $1`, dbUserId
  );
  const trustLevel = userRows[0]?.verification_tier ?? "none";

  for (const c of body.corrections) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO user_corrections (user_id, stavba_id, del_stavbe_id, atribut, vrednost, trust_level)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      dbUserId, body.stavba_id, body.del_stavbe_id ?? null,
      c.atribut, c.vrednost, trustLevel
    );
  }

  // Claim stavbo če ni že
  await prisma.$executeRawUnsafe(
    `INSERT INTO user_property_claims (user_id, stavba_id, del_stavbe_id, verification_tier, verified_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, stavba_id, del_stavbe_id) DO NOTHING`,
    dbUserId, body.stavba_id, body.del_stavbe_id ?? null, trustLevel
  );

  return NextResponse.json({ ok: true, trustLevel });
}
