import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const NotifySchema = z.object({
  email: z.string().email("Neveljaven e-poštni naslov"),
  naslov: z.string().min(3, "Naslov mora vsebovati vsaj 3 znake"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, naslov } = NotifySchema.parse(body);

    await prisma.leadEmail.create({
      data: { email, naslov },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 },
      );
    }

    console.error("Notify error:", error);
    return NextResponse.json(
      { success: false, error: "Napaka pri shranjevanju" },
      { status: 500 },
    );
  }
}
