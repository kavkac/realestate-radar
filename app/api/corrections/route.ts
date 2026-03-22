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

  // Hierarchy: lastnik=solastnik(4) > upravljalec(3) > agent(2) > own private(1)
  // DISTINCT ON (atribut) returns only the highest-ranked correction per field
  const rows = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT DISTINCT ON (c.atribut)
            c.atribut, c.vrednost, c.trust_level, c.is_public, c.created_at,
            (c.user_id = $2) AS is_own,
            cl.verification_tier AS vloga,
            CASE cl.verification_tier
              WHEN 'lastnik'     THEN 4
              WHEN 'solastnik'   THEN 4
              WHEN 'upravljalec' THEN 3
              WHEN 'agent'       THEN 2
              ELSE 1
            END AS vloga_rank
     FROM user_corrections c
     JOIN users u ON u.id = c.user_id
     LEFT JOIN user_property_claims cl ON cl.user_id = c.user_id AND cl.stavba_id = c.stavba_id
     WHERE c.stavba_id = $1
       AND (c.is_public = true OR c.user_id = $2)
     ORDER BY c.atribut, vloga_rank DESC, c.created_at DESC`,
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
       ON CONFLICT (user_id, stavba_id, atribut) DO UPDATE SET vrednost = EXCLUDED.vrednost, trust_level = EXCLUDED.trust_level, is_public = EXCLUDED.is_public`,
      dbUserId, body.stavba_id, body.del_stavbe_id ?? null,
      c.atribut, c.vrednost, trustLevel, isPublic
    );
  }

  // Claim stavbo če ni že
  await prisma.$executeRawUnsafe(
    `INSERT INTO user_property_claims (user_id, stavba_id, del_stavbe_id, verification_tier, verified_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT DO NOTHING`,
    dbUserId, body.stavba_id, body.del_stavbe_id ?? null, trustLevel
  );

  return NextResponse.json({ ok: true, trustLevel });
}

// DELETE /api/corrections?stavba_id=KO-ST
export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const stavbaId = req.nextUrl.searchParams.get("stavba_id");
  if (!stavbaId) return NextResponse.json({ error: "Missing stavba_id" }, { status: 400 });

  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `SELECT id FROM users WHERE clerk_id = $1 LIMIT 1`, userId
  );
  if (!rows.length) return NextResponse.json({ ok: true });
  const dbUserId = rows[0].id;

  await prisma.$executeRawUnsafe(
    `DELETE FROM user_corrections WHERE user_id = $1 AND stavba_id = $2`,
    dbUserId, stavbaId
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM user_property_claims WHERE user_id = $1 AND stavba_id = $2`,
    dbUserId, stavbaId
  );

  return NextResponse.json({ ok: true });
}
