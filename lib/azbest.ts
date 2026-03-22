/**
 * Azbest (Asbestos) risk assessment
 * Slovenia banned asbestos in 1996. Buildings built before 1996 may contain it.
 * Peak usage: 1960-1985 (highest risk).
 * No public NIJZ API — using year-of-construction heuristic.
 */

export interface AzbestRisk {
  hasRisk: boolean;
  level: "visoko" | "srednje" | "nizko" | null;
  note: string;
}

export function getAzbestRisk(letoIzgradnje: number | null | undefined): AzbestRisk {
  if (!letoIzgradnje) return { hasRisk: false, level: null, note: "" };
  if (letoIzgradnje <= 1985) {
    return {
      hasRisk: true,
      level: "visoko",
      note: "Visoko tveganje azbestnih materialov — zgrajena pred 1985 (vrhunec uporabe azbesta v SLO)",
    };
  }
  if (letoIzgradnje <= 1996) {
    return {
      hasRisk: true,
      level: "srednje",
      note: "Možno tveganje azbestnih materialov — azbest v SLO prepovedan 1996",
    };
  }
  return { hasRisk: false, level: "nizko", note: "" };
}
