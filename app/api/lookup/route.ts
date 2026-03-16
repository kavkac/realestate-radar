import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { lookupByAddress } from "@/lib/gurs-api";
import { lookupEnergyCertificate } from "@/lib/eiz-lookup";

const LookupSchema = z.object({
  address: z.string().min(3, "Naslov mora vsebovati vsaj 3 znake"),
  delStavbe: z.number().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, delStavbe } = LookupSchema.parse(body);

    const result = await lookupByAddress(address);
    if (!result) {
      return NextResponse.json(
        { success: false, error: "Naslov ni bil najden v evidenci GURS" },
        { status: 404 },
      );
    }

    const { stavba, deliStavbe } = result;

    // Determine stDelaStavbe for energy cert lookup
    const stDelaStavbe =
      delStavbe ?? (deliStavbe.length === 1 ? deliStavbe[0].stDelaStavbe : undefined);

    // Fetch energy certificate from DB
    let energetskaIzkaznica = null;
    try {
      const cert = await lookupEnergyCertificate({
        koId: stavba.koId,
        stStavbe: stavba.stStavbe,
        stDelaStavbe,
      });
      if (cert) {
        energetskaIzkaznica = {
          razred: cert.energyClass,
          datumIzdaje: cert.issueDate.toISOString().split("T")[0],
          veljaDo: cert.validUntil.toISOString().split("T")[0],
          potrebnaTopota: cert.heatingNeed,
          primaryEnergy: cert.primaryEnergy,
          co2: cert.co2Emissions,
          povrsina: cert.area,
        };
      }
    } catch {
      // DB not available — skip silently
    }

    return NextResponse.json({
      success: true,
      naslov: address,
      enolicniId: {
        koId: stavba.koId,
        stStavbe: stavba.stStavbe,
        stDelaStavbe: stDelaStavbe ?? null,
      },
      stavba: {
        letoIzgradnje: stavba.letoIzgradnje,
        letoObnove: {
          fasade: stavba.letoObnoveFasade,
          strehe: stavba.letoObnoveStrehe,
        },
        steviloEtaz: stavba.steviloEtaz,
        steviloStanovanj: stavba.steviloStanovanj,
        povrsina: stavba.brutoTlorisnaPovrsina,
        konstrukcija: stavba.nosilnaKonstrukcija,
        tip: stavba.tipStavbe,
        prikljucki: {
          elektrika: stavba.elektrika,
          plin: stavba.plin,
          vodovod: stavba.vodovod,
          kanalizacija: stavba.kanalizacija,
        },
      },
      deliStavbe: deliStavbe.map((d) => ({
        stDela: d.stDelaStavbe,
        povrsina: d.povrsina,
        uporabnaPovrsina: d.uporabnaPovrsina,
        vrsta: d.vrsta,
      })),
      energetskaIzkaznica,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 },
      );
    }

    console.error("Lookup error:", error);
    return NextResponse.json(
      { success: false, error: "Napaka pri iskanju nepremičnine" },
      { status: 500 },
    );
  }
}
