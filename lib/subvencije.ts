export interface Subvencija {
  id: number;
  naziv: string;
  kratek_opis: string;
  vir: string;
  tip: string;
  namen: string;
  max_znesek: number | null;
  max_delez: number | null;
  url: string;
  pogoji: {
    letoGradnje_max?: number;
    namembnost?: string[];
    energijskiRazred_max?: string;
  };
}

const ENERGY_ORDER = ["A+", "A", "B", "C", "D", "E", "F", "G"];

function energyWorseOrEqual(razred: string, max: string): boolean {
  return ENERGY_ORDER.indexOf(razred) >= ENERGY_ORDER.indexOf(max);
}

export function matchSubvencije(
  all: Subvencija[],
  opts: {
    letoGradnje?: number | null;
    energijskiRazred?: string | null;
    tipStavbe?: "stanovanje" | "stavba" | "parcela" | null;
  }
): Subvencija[] {
  const tip = opts.tipStavbe === "parcela" ? null : (opts.tipStavbe ?? "stanovanje");

  return all.filter(s => {
    const p = s.pogoji;
    if (p.letoGradnje_max && opts.letoGradnje && opts.letoGradnje > p.letoGradnje_max) return false;
    if (p.namembnost && tip && !p.namembnost.includes(tip)) return false;
    if (p.energijskiRazred_max && opts.energijskiRazred) {
      if (!energyWorseOrEqual(opts.energijskiRazred, p.energijskiRazred_max)) return false;
    }
    return true;
  });
}
