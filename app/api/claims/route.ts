import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const VALID_ROLES = ["lastnik", "solastnik", "upravljavec", "agent", "drugo"];

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { stavba_id: string; del_stavbe_id?: string; vloga: string };
  if (!VALID_ROLES.includes(body.vloga)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });

  // Get or create user
  let rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `SELECT id FROM users WHERE clerk_id = $1 LIMIT 1`, userId
  );
  if (!rows.length) {
    rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO users (clerk_id) VALUES ($1) RETURNING id`, userId
    );
  }
  const dbUserId = rows[0].id;

  // Upsert claim
  await prisma.$executeRawUnsafe(
    `INSERT INTO user_property_claims (user_id, stavba_id, del_stavbe_id, verification_tier, verified_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, stavba_id, del_stavbe_id)
     DO UPDATE SET verification_tier = EXCLUDED.verification_tier, verified_at = NOW()`,
    dbUserId, body.stavba_id, body.del_stavbe_id ?? null, body.vloga
  );

  // Mark all existing corrections for this property as public (self-declared)
  await prisma.$executeRawUnsafe(
    `UPDATE user_corrections SET is_public = true, trust_level = $3
     WHERE user_id = $1 AND stavba_id = $2`,
    dbUserId, body.stavba_id, body.vloga
  );

  // Update user verification tier
  await prisma.$executeRawUnsafe(
    `UPDATE users SET verification_tier = $2 WHERE id = $1`,
    dbUserId, body.vloga
  );

  return NextResponse.json({ ok: true, vloga: body.vloga });
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ claim: null });
  const stavbaId = req.nextUrl.searchParams.get("stavba_id");
  if (!stavbaId) return NextResponse.json({ claim: null });

  const rows = await prisma.$queryRawUnsafe<{ verification_tier: string; verified_at: string }[]>(
    `SELECT c.verification_tier, c.verified_at FROM user_property_claims c
     JOIN users u ON u.id = c.user_id
     WHERE u.clerk_id = $1 AND c.stavba_id = $2 LIMIT 1`,
    userId, stavbaId
  );
  return NextResponse.json({ claim: rows[0] ?? null });
}
