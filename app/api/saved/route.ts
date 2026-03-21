import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Upsert ali ustvari users record iz Clerk ID
async function getOrCreateUser(clerkId: string, email?: string | null) {
  let user = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `SELECT id FROM users WHERE clerk_id = $1 LIMIT 1`, clerkId
  );
  if (user.length === 0) {
    user = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`,
      clerkId, email ?? null
    );
  }
  return user[0].id;
}

// GET /api/saved?type=watchlist|history|search
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const type = req.nextUrl.searchParams.get("type") ?? "watchlist";
  const dbUserId = await getOrCreateUser(userId);

  const items = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT id, stavba_id, data, created_at FROM user_saved
     WHERE user_id = $1 AND type = $2
     ORDER BY created_at DESC LIMIT 50`,
    dbUserId, type
  );

  return NextResponse.json({ items });
}

// POST /api/saved — dodaj v watchlist/history
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { type: string; stavba_id: string; data?: unknown };
  const { type, stavba_id, data } = body;

  if (!type || !stavba_id) {
    return NextResponse.json({ error: "type and stavba_id required" }, { status: 400 });
  }

  const dbUserId = await getOrCreateUser(userId);

  // History: max 20 zapisov, briši najstarejše
  if (type === "history") {
    const count = await prisma.$queryRawUnsafe<{ count: string }[]>(
      `SELECT COUNT(*) FROM user_saved WHERE user_id = $1 AND type = 'history'`, dbUserId
    );
    if (Number(count[0].count) >= 20) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM user_saved WHERE id = (
          SELECT id FROM user_saved WHERE user_id = $1 AND type = 'history'
          ORDER BY created_at ASC LIMIT 1
        )`, dbUserId
      );
    }
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO user_saved (user_id, type, stavba_id, data)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (user_id, type, stavba_id)
     DO UPDATE SET data = EXCLUDED.data, created_at = NOW()`,
    dbUserId, type, stavba_id, JSON.stringify(data ?? {})
  );

  return NextResponse.json({ ok: true });
}

// DELETE /api/saved — odstrani iz watchlist
export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { type: string; stavba_id: string };
  const dbUserId = await getOrCreateUser(userId);

  await prisma.$executeRawUnsafe(
    `DELETE FROM user_saved WHERE user_id = $1 AND type = $2 AND stavba_id = $3`,
    dbUserId, body.type, body.stavba_id
  );

  return NextResponse.json({ ok: true });
}
