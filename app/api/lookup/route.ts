import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const LookupSchema = z.object({
  address: z.string().min(3, "Naslov mora vsebovati vsaj 3 znake"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address } = LookupSchema.parse(body);

    // TODO: 1. Parse address into street + house number
    // TODO: 2. Call GursAPI to resolve koId, stStavbe, stDelaStavbe
    // TODO: 3. Fetch building data from GURS WFS
    // TODO: 4. Fetch energy certificate from DB
    // TODO: 5. Fetch transactions from DB
    // TODO: 6. Return aggregated result

    return NextResponse.json({
      success: true,
      address,
      message: "Iskanje nepremičnine — še v razvoju",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Napaka pri iskanju" },
      { status: 500 }
    );
  }
}
