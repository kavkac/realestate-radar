"use client";

import React, { useState, useEffect, useCallback } from "react";

interface PropertyEditDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  stavbaId: string;
  delStavbeId?: string | null;
  naslov: string;
  onSaved: () => void;
}

export function PropertyEditDrawer({
  isOpen,
  onClose,
  stavbaId,
  delStavbeId,
  naslov,
  onSaved,
}: PropertyEditDrawerProps) {
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vloga, setVloga] = useState("");

  // Reset form when drawer opens
  useEffect(() => {
    if (isOpen) {
      setEditValues({});
      setError(null);
      setVloga("");
    }
  }, [isOpen]);

  // Fetch existing claim and corrections on mount
  useEffect(() => {
    if (!isOpen) return;
    // Fetch claim
    fetch(`/api/claims?stavba_id=${stavbaId}`)
      .then(r => r.json())
      .then(data => { if (data.claim) setVloga(data.claim.verification_tier); })
      .catch(() => {});
    // Fetch existing corrections and pre-fill form
    fetch(`/api/corrections?stavba_id=${stavbaId}`)
      .then(r => r.json())
      .then(data => {
        const corrs = data.corrections ?? [];
        // Only use own corrections (is_own = true)
        const ownCorrs = corrs.filter((c: { is_own: boolean }) => c.is_own);
        const values: Record<string, string> = {};
        for (const c of ownCorrs) {
          values[c.atribut] = c.vrednost;
        }
        if (Object.keys(values).length > 0) {
          setEditValues(values);
        }
      })
      .catch(() => {});
  }, [isOpen, stavbaId]);

  // ESC key closes drawer
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleReset = useCallback(async () => {
    if (!confirm("Res želiš izbrisati vse svoje vnose za to nepremičnino?")) return;
    try {
      await fetch(`/api/corrections?stavba_id=${stavbaId}`, { method: "DELETE" });
      setEditValues({});
      setVloga("");
      onSaved();
      onClose();
    } catch {
      // ignore
    }
  }, [stavbaId, onSaved, onClose]);

  const handleSave = useCallback(async () => {
    const corrections = Object.entries(editValues)
      .filter(([, v]) => v.trim() !== "")
      .map(([atribut, vrednost]) => ({ atribut, vrednost }));

    if (corrections.length === 0 && !vloga) {
      setError("Izpolnite vsaj eno polje.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Save corrections if any
      if (corrections.length > 0) {
        const res = await fetch("/api/corrections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stavba_id: stavbaId, del_stavbe_id: delStavbeId, corrections }),
        });
        if (!res.ok) throw new Error("Napaka pri shranjevanju");
      }

      // Save claim if vloga selected
      if (vloga) {
        const claimRes = await fetch("/api/claims", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stavba_id: stavbaId, del_stavbe_id: delStavbeId, vloga }),
        });
        if (!claimRes.ok) throw new Error("Napaka pri shranjevanju vloge");
      }

      onSaved();
      onClose();
    } catch {
      setError("Napaka pri shranjevanju. Poskusite znova.");
    } finally {
      setSaving(false);
    }
  }, [editValues, stavbaId, delStavbeId, vloga, onSaved, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className={`
          fixed z-50 bg-white shadow-2xl flex flex-col
          transition-transform duration-300 ease-out

          /* Mobile: bottom sheet */
          bottom-0 left-0 right-0 h-[85vh] rounded-t-2xl
          translate-y-0

          /* Desktop: right panel */
          md:top-0 md:bottom-0 md:left-auto md:right-0
          md:w-[380px] md:h-full md:rounded-none
          md:translate-y-0 md:translate-x-0
        `}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0">
            <h2 id="drawer-title" className="text-sm font-bold text-gray-800 flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-500">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Predlagaj popravek
            </h2>
            <p className="text-xs text-gray-400 mt-0.5 truncate">{naslov}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 -mr-1"
            aria-label="Zapri"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {/* Section: Vaša vloga */}
          <div className="mb-4 pb-4 border-b border-gray-100 mt-4">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Vaša vloga za to nepremičnino
            </p>
            <select
              value={vloga}
              onChange={e => setVloga(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400 outline-none"
            >
              <option value="">Izberite vlogo...</option>
              <option value="lastnik">Lastnik</option>
              <option value="solastnik">Solastnik</option>
              <option value="upravljavec">Upravljavec</option>
              <option value="agent">Nepremičninski agent</option>
              <option value="drugo">Drugo relevantno razmerje</option>
            </select>
            {vloga && (
              <p className="text-[10px] text-gray-400 mt-1.5">
                Z oddajo izjavljate, da imate navedeno razmerje s to nepremičnino. Vaše informacije bodo vidne vsem obiskovalcem.
              </p>
            )}
            {!vloga && (
              <p className="text-[10px] text-gray-400 mt-1.5">
                Brez navedene vloge so vaše informacije vidne samo vam.
              </p>
            )}
          </div>

          {/* Section 1: Obnove */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Obnove
          </p>

          <div className="flex flex-col gap-1 mb-3">
            <label className="text-xs text-gray-500">Fasada obnovljena</label>
            <input
              type="number"
              placeholder="leto npr. 2018"
              value={editValues.fasada_leto ?? ""}
              onChange={(e) => setEditValues({ ...editValues, fasada_leto: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none"
            />
          </div>

          <div className="flex flex-col gap-1 mb-3">
            <label className="text-xs text-gray-500">Streha obnovljena</label>
            <input
              type="number"
              placeholder="leto npr. 2015"
              value={editValues.streha_leto ?? ""}
              onChange={(e) => setEditValues({ ...editValues, streha_leto: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none"
            />
          </div>

          <div className="flex flex-col gap-1 mb-3">
            <label className="text-xs text-gray-500">Okna zamenjana</label>
            <input
              type="number"
              placeholder="leto npr. 2020"
              value={editValues.okna_leto ?? ""}
              onChange={(e) => setEditValues({ ...editValues, okna_leto: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none"
            />
          </div>

          {/* Section 2: Instalacije */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 mt-4">
            🔌 Instalacije
          </p>

          <div className="flex flex-col gap-1 mb-3">
            <label className="text-xs text-gray-500">Plin</label>
            <select
              value={editValues.plin ?? ""}
              onChange={(e) => setEditValues({ ...editValues, plin: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none bg-white"
            >
              <option value="">— izberite —</option>
              <option value="Da">Da</option>
              <option value="Ne">Ne</option>
              <option value="V gradnji">V gradnji</option>
            </select>
          </div>

          <div className="flex flex-col gap-1 mb-3">
            <label className="text-xs text-gray-500">Elektrika</label>
            <select
              value={editValues.elektrika ?? ""}
              onChange={(e) => setEditValues({ ...editValues, elektrika: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none bg-white"
            >
              <option value="">— izberite —</option>
              <option value="Da">Da</option>
              <option value="Ne">Ne</option>
              <option value="V gradnji">V gradnji</option>
            </select>
          </div>

          <div className="flex flex-col gap-1 mb-3">
            <label className="text-xs text-gray-500">Vodovod</label>
            <select
              value={editValues.vodovod ?? ""}
              onChange={(e) => setEditValues({ ...editValues, vodovod: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none bg-white"
            >
              <option value="">— izberite —</option>
              <option value="Da">Da</option>
              <option value="Ne">Ne</option>
              <option value="V gradnji">V gradnji</option>
            </select>
          </div>

          <div className="flex flex-col gap-1 mb-3">
            <label className="text-xs text-gray-500">Kanalizacija</label>
            <select
              value={editValues.kanalizacija ?? ""}
              onChange={(e) => setEditValues({ ...editValues, kanalizacija: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none bg-white"
            >
              <option value="">— izberite —</option>
              <option value="Da">Da</option>
              <option value="Ne">Ne</option>
              <option value="V gradnji">V gradnji</option>
            </select>
          </div>

          {/* Section 3: Sistemi */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 mt-4">
            Sistemi
          </p>

          <div className="flex flex-col gap-1 mb-3">
            <label className="text-xs text-gray-500">Dvigalo</label>
            <select
              value={editValues.dvigalo ?? ""}
              onChange={(e) => setEditValues({ ...editValues, dvigalo: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none bg-white"
            >
              <option value="">— izberite —</option>
              <option value="Da">Da</option>
              <option value="Ne">Ne</option>
              <option value="V gradnji">V gradnji</option>
            </select>
          </div>

          <div className="flex flex-col gap-1 mb-3">
            <label className="text-xs text-gray-500">Ogrevanje</label>
            <select
              value={editValues.ogrevanje ?? ""}
              onChange={(e) => setEditValues({ ...editValues, ogrevanje: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none bg-white"
            >
              <option value="">— izberite —</option>
              <option value="Daljinsko">Daljinsko</option>
              <option value="Plin">Plin</option>
              <option value="Toplotna crpalka">Toplotna črpalka</option>
              <option value="Elektricno">Električno</option>
              <option value="Olje">Olje</option>
              <option value="Drva/Peleti">Drva/Peleti</option>
            </select>
          </div>

          {/* Section 3: Stanje */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 mt-4">
            Stanje
          </p>

          <div className="flex flex-col gap-1 mb-3">
            <label className="text-xs text-gray-500">Stanje nepremičnine</label>
            <select
              value={editValues.stanje ?? ""}
              onChange={(e) => setEditValues({ ...editValues, stanje: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none bg-white"
            >
              <option value="">— izberite —</option>
              <option value="Odlicno">Odlično</option>
              <option value="Dobro">Dobro</option>
              <option value="Povprecno">Povprečno</option>
              <option value="Potrebuje obnovo">Potrebuje obnovo</option>
            </select>
          </div>

          <div className="flex flex-col gap-1 mb-3">
            <label className="text-xs text-gray-500">Parkirišče</label>
            <select
              value={editValues.parkirisce ?? ""}
              onChange={(e) => setEditValues({ ...editValues, parkirisce: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none bg-white"
            >
              <option value="">— izberite —</option>
              <option value="Garaza">Garaža</option>
              <option value="Garazno mesto">Garažno mesto</option>
              <option value="Zunanji prostor">Zunanji prostor</option>
              <option value="Ni parkiranja">Ni parkiranja</option>
            </select>
          </div>

          {/* Section 4: Opomba */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 mt-4">
            Opomba
          </p>

          <div className="flex flex-col gap-1 mb-3">
            <textarea
              rows={3}
              placeholder="Npr. nova kopalnica 2022, prenovljena kuhinja..."
              value={editValues.opomba ?? ""}
              onChange={(e) => setEditValues({ ...editValues, opomba: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none resize-none"
            />
          </div>

          {/* Legal disclaimer */}
          <p className="text-xs text-gray-400 mt-4 p-3 bg-gray-50 rounded-lg">
            Z oddajo potrjujem točnost podatkov in da sem pooblaščen za to nepremičnino.
          </p>

          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-gray-200 bg-white px-5 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Prekliči
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-brand-500 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50"
          >
            {saving ? "Shranjujem..." : "Shrani"}
          </button>
        </div>

        {/* Delete all link */}
        <div className="px-5 pb-3 text-center">
          <button
            onClick={handleReset}
            className="text-xs text-red-400 hover:text-red-600 transition-colors"
          >
            Izbriši vse moje podatke za to nepremičnino
          </button>
        </div>
      </div>
    </>
  );
}
