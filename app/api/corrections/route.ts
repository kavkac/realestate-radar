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
  const { userId } = await auth();
  const stavbaId = req.nextUrl.searchParams.get("stavba_id");
  if (!stavbaId) return NextResponse.json({ corrections: [] });

  // Get current user DB id (null if not logged in)
  let dbUserId: number | null = null;
  if (userId) {
    const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `SELECT id FROM users WHERE clerk_id = $1 LIMIT 1`, userId
    );
    if (rows.length) dbUserId = rows[0].id;
  }

  // Return public corrections + own private corrections
  const rows = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT c.atribut, c.vrednost, c.trust_level, c.is_public, c.created_at,
            u.verification_tier,
            (c.user_id = $2) AS is_own
     FROM user_corrections c
     JOIN users u ON u.id = c.user_id
     WHERE c.stavba_id = $1
       AND (c.is_public = true OR c.user_id = $2)
     ORDER BY c.is_public DESC, c.created_at DESC`,
    stavbaId, dbUserId ?? -1
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

  const isPublic = ["bank", "agent"].includes(trustLevel);
  for (const c of body.corrections) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO user_corrections (user_id, stavba_id, del_stavbe_id, atribut, vrednost, trust_level, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      dbUserId, body.stavba_id, body.del_stavbe_id ?? null,
      c.atribut, c.vrednost, trustLevel, isPublic
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
