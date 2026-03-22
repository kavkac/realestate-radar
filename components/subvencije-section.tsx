"use client";
import { useEffect, useState } from "react";
import { Subvencija } from "@/lib/subvencije";

const VIR_LABEL: Record<string, string> = {
  ekosklad: "Eko sklad",
  stanovanjski_sklad: "Stanovanjski sklad RS",
  sid: "SID banka",
};

function TipBadge({ tip }: { tip: string }) {
  if (tip === "nepovratna") return (
    <span className="text-[9px] font-semibold tracking-wide uppercase bg-green-50 text-green-700 border border-green-100 rounded px-1.5 py-0.5 shrink-0">
      Nepovratna
    </span>
  );
  if (tip === "kredit") return (
    <span className="text-[9px] font-semibold tracking-wide uppercase bg-blue-50 text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 shrink-0">
      Kredit
    </span>
  );
  return null;
}

interface Props {
  letoGradnje?: number | null;
  energijskiRazred?: string | null;
  tipStavbe?: string | null;
}

export function SubvencijeSection({ letoGradnje, energijskiRazred, tipStavbe }: Props) {
  const [items, setItems] = useState<Subvencija[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (letoGradnje) params.set("letoGradnje", String(letoGradnje));
    if (energijskiRazred) params.set("energijskiRazred", energijskiRazred);
    if (tipStavbe) params.set("tipStavbe", tipStavbe);
    fetch(`/api/subvencije?${params}`)
      .then(r => r.json())
      .then(d => setItems(d.subvencije ?? []))
      .finally(() => setLoading(false));
  }, [letoGradnje, energijskiRazred, tipStavbe]);

  if (loading || !items.length) return null;

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
      <div className="space-y-4">
        {Object.entries(grouped).map(([vir, subs]) => (
          <div key={vir}>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
              {VIR_LABEL[vir] ?? vir}
            </p>
            <div className="divide-y divide-gray-50">
              {subs.map(s => (
                <a
                  key={s.id}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 py-2.5 hover:bg-gray-50 -mx-1 px-1 rounded transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-800 group-hover:text-brand-700 leading-snug">
                        {s.naziv}
                      </span>
                      <TipBadge tip={s.tip} />
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{s.kratek_opis}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 mt-0.5">
                    {(s.max_znesek || s.max_delez) && (
                      <span className="text-xs text-gray-500 text-right whitespace-nowrap">
                        {s.max_delez ? `do ${s.max_delez}%` : ""}
                        {s.max_znesek ? `${s.max_delez ? " · " : ""}${s.max_znesek.toLocaleString("sl-SI")} €` : ""}
                      </span>
                    )}
                    <svg className="w-3.5 h-3.5 text-gray-300 group-hover:text-brand-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
