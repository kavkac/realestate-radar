"use client";
import { useEffect, useState } from "react";

interface Subvencija {
  id: number;
  naziv: string;
  kratek_opis: string;
  tip: string;
  vir: string;
  url: string;
  max_znesek?: number | null;
  max_delez?: number | null;
}

interface Props {
  letoGradnje?: number | null;
  energijskiRazred?: string | null;
  tipStavbe?: string | null;
}

const VIR_LABEL: Record<string, string> = {
  "eko_sklad": "Eko sklad",
  "ssrs": "SSRS",
  "sid": "SID banka",
};

export function SubvencijeSection({ letoGradnje, energijskiRazred, tipStavbe }: Props) {
  const [items, setItems] = useState<Subvencija[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

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
    <div className="border-b border-gray-100">
      <button
        className="w-full flex items-center justify-between px-3 sm:px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <span className="border-l-[3px] border-[#2d6a4f] pl-2 text-sm font-semibold text-gray-800">
            Razpoložljive spodbude
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
            {items.length}
          </span>
        </div>
        <span className="text-gray-400 text-xs flex items-center gap-1">
          {open ? "Skrij" : "Prikaži"} <span className="text-sm">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {open && (
        <div className="px-3 sm:px-5 pt-4 pb-5 space-y-4">
          {Object.entries(grouped).map(([vir, subs]) => (
            <div key={vir}>
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1.5">
                {VIR_LABEL[vir] ?? vir}
              </p>
              <div className="divide-y divide-gray-50">
                {subs.map(s => (
                  <a
                    key={s.id}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start justify-between gap-3 py-2.5 hover:bg-gray-50 -mx-1 px-1 rounded transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 group-hover:text-gray-900 leading-snug">{s.naziv}</p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-snug">{s.kratek_opis}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 mt-0.5">
                      {(s.max_znesek || s.max_delez) && (
                        <span className="text-xs text-gray-500 text-right whitespace-nowrap">
                          {s.max_delez ? `do ${s.max_delez}%` : ""}
                          {s.max_znesek ? `${s.max_delez ? " · " : ""}${s.max_znesek.toLocaleString("sl-SI")} €` : ""}
                        </span>
                      )}
                      <svg className="w-3 h-3 text-gray-300 group-hover:text-gray-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
