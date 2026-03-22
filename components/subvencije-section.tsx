"use client";
import { useEffect, useState } from "react";
import { Subvencija } from "@/lib/subvencije";

const VIR_LABEL: Record<string, string> = {
  ekosklad: "Eko sklad",
  stanovanjski_sklad: "Stanovanjski sklad RS",
  sid: "SID banka",
};

const TIP_ICON: Record<string, string> = {
  nepovratna: "🎁",
  kredit: "🏦",
  garancija: "🛡️",
};

interface Props {
  letoGradnje?: number | null;
  energijskiRazred?: string | null;
  tipStavbe?: "stanovanje" | "stavba" | "parcela" | null;
}

export function SubvencijeSection({ letoGradnje, energijskiRazred, tipStavbe }: Props) {
  const [items, setItems] = useState<Subvencija[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (letoGradnje) params.set("letoGradnje", letoGradnje.toString());
    if (energijskiRazred) params.set("energijskiRazred", energijskiRazred);
    if (tipStavbe) params.set("tipStavbe", tipStavbe);

    fetch(`/api/subvencije?${params}`)
      .then(r => r.json())
      .then(d => setItems(d.subvencije ?? []))
      .finally(() => setLoading(false));
  }, [letoGradnje, energijskiRazred, tipStavbe]);

  if (loading) return null;
  if (!items.length) return null;

  // Group by vir
  const grouped = items.reduce((acc, s) => {
    if (!acc[s.vir]) acc[s.vir] = [];
    acc[s.vir].push(s);
    return acc;
  }, {} as Record<string, Subvencija[]>);

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
        Razpoložljive spodbude
      </p>
      <div className="space-y-3">
        {Object.entries(grouped).map(([vir, subs]) => (
          <div key={vir}>
            <p className="text-[10px] text-gray-400 font-medium mb-1.5">{VIR_LABEL[vir] ?? vir}</p>
            <div className="space-y-1.5">
              {subs.map(s => (
                <a
                  key={s.id}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2.5 group"
                >
                  <span className="text-sm mt-0.5">{TIP_ICON[s.tip] ?? "💡"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-gray-700 group-hover:text-brand-600 transition-colors leading-snug">
                        {s.naziv}
                      </p>
                      {(s.max_znesek || s.max_delez) && (
                        <span className="text-[10px] text-gray-400 shrink-0">
                          {s.max_delez ? `do ${s.max_delez}%` : ""}{s.max_znesek ? ` / ${s.max_znesek.toLocaleString("sl-SI")} €` : ""}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 leading-snug mt-0.5">{s.kratek_opis}</p>
                  </div>
                  <span className="text-gray-300 group-hover:text-brand-400 transition-colors text-xs mt-0.5">→</span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
