"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";

interface EditPropertyFormProps {
  stavbaId: string; // format: "KO-STSTAV"
  delStavbeId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const FIELDS = [
  { key: "fasada_leto", label: "Fasada obnovljena (leto)", type: "number", placeholder: "2018" },
  { key: "streha_leto", label: "Streha obnovljena (leto)", type: "number", placeholder: "2015" },
  { key: "okna_leto", label: "Okna zamenjana (leto)", type: "number", placeholder: "2020" },
  { key: "dvigalo", label: "Dvigalo", type: "select", options: ["Da", "Ne", "V gradnji"] },
  { key: "ogrevanje", label: "Ogrevanje", type: "select", options: ["Daljinsko", "Plin", "Toplotna črpalka", "Električno", "Olje", "Drva/Peleti"] },
  { key: "stanje", label: "Stanje nepremičnine", type: "select", options: ["Odlično", "Dobro", "Povprečno", "Potrebuje obnovo"] },
  { key: "parkirisce", label: "Parkirno mesto", type: "select", options: ["Garaža", "Garažno mesto", "Zunanji prostor", "Ni parkiranja"] },
  { key: "opomba", label: "Opomba (vidno z badgeom)", type: "text", placeholder: "Npr: nova kopalnica 2022" },
];

export default function EditPropertyForm({ stavbaId, delStavbeId, onClose, onSaved }: EditPropertyFormProps) {
  const { isSignedIn } = useUser();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSignedIn) return null;

  async function handleSave() {
    const corrections = Object.entries(values)
      .filter(([, v]) => v.trim() !== "")
      .map(([atribut, vrednost]) => ({ atribut, vrednost }));

    if (corrections.length === 0) {
      setError("Izpolnite vsaj eno polje.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stavba_id: stavbaId, del_stavbe_id: delStavbeId, corrections }),
      });
      if (!res.ok) throw new Error("Napaka pri shranjevanju");
      onSaved();
      onClose();
    } catch {
      setError("Napaka pri shranjevanju. Poskusite znova.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Uredi podatke o nepremičnini</h2>
            <p className="text-xs text-gray-400 mt-0.5">Vaši vnosi bodo prikazani z <span className="text-amber-600">👤 Lastnik poroča</span> oznakom</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4">
          {FIELDS.map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}</label>
              {field.type === "select" ? (
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                >
                  <option value="">— izberite —</option>
                  {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={field.type}
                  placeholder={field.placeholder}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                />
              )}
            </div>
          ))}

          {error && <p className="text-xs text-red-600">{error}</p>}

          {/* Izjava */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
            Z oddajo potrjujem, da so podatki točni in da sem za to nepremičnino pooblaščen. Zavajanje je kaznivo.
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Prekliči
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-brand-500 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50"
          >
            {saving ? "Shranjujem..." : "Shrani"}
          </button>
        </div>
      </div>
    </div>
  );
}
