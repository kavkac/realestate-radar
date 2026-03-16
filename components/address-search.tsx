"use client";

import { useState } from "react";
import { PropertyCard } from "./property-card";

interface LookupResult {
  success: boolean;
  error?: string;
  naslov?: string;
  enolicniId?: { koId: number; stStavbe: number; stDelaStavbe: number | null };
  stavba?: {
    letoIzgradnje: number | null;
    letoObnove: { fasade: number | null; strehe: number | null };
    steviloEtaz: number | null;
    steviloStanovanj: number | null;
    povrsina: number | null;
    konstrukcija: string | null;
    tip: string | null;
    prikljucki: {
      elektrika: boolean;
      plin: boolean;
      vodovod: boolean;
      kanalizacija: boolean;
    };
  };
  deliStavbe?: {
    stDela: number;
    povrsina: number | null;
    uporabnaPovrsina: number | null;
    vrsta: string | null;
  }[];
  energetskaIzkaznica?: {
    razred: string;
    datumIzdaje: string;
    veljaDo: string;
    potrebnaTopota: number | null;
    primaryEnergy: number | null;
    co2: number | null;
    povrsina: number | null;
  } | null;
}

export function AddressSearch() {
  const [address, setAddress] = useState("");
  const [delStavbe, setDelStavbe] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const body: Record<string, unknown> = { address };
      if (delStavbe.trim()) {
        body.delStavbe = parseInt(delStavbe, 10);
      }

      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data: LookupResult = await res.json();

      if (!data.success) {
        setError(data.error ?? "Napaka pri iskanju");
        return;
      }

      setResult(data);
    } catch {
      setError("Napaka pri povezovanju s strežnikom");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="npr. Slovenčeva ulica 4"
            className="flex-1 rounded-md border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || address.length < 3}
            className="rounded-md bg-[#2d6a4f] px-6 py-3 text-sm font-medium text-white hover:bg-[#245a42] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Iščem..." : "Poišči"}
          </button>
        </div>

        <input
          type="text"
          value={delStavbe}
          onChange={(e) => setDelStavbe(e.target.value)}
          placeholder="Številka dela stavbe (stanovanja) — neobvezno"
          className="w-full rounded-md border border-input bg-background px-4 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={loading}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#2d6a4f] border-t-transparent" />
          <span className="ml-3 text-sm text-muted-foreground">
            Pridobivam podatke iz GURS...
          </span>
        </div>
      )}

      {result?.success && result.naslov && result.stavba && (
        <PropertyCard
          naslov={result.naslov}
          enolicniId={result.enolicniId!}
          stavba={result.stavba}
          deliStavbe={result.deliStavbe ?? []}
          energetskaIzkaznica={result.energetskaIzkaznica ?? null}
        />
      )}
    </div>
  );
}
