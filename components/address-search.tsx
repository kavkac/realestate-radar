"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { PropertyCard } from "./property-card";

interface Prostor {
  vrsta: string;
  povrsina: number | null;
}

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
    letoObnoveInstalacij: number | null;
    letoObnoveOken: number | null;
    dvigalo: boolean;
    prostori: Prostor[];
  }[];
  energetskaIzkaznica?: {
    razred: string;
    tip: string | null;
    datumIzdaje: string;
    veljaDo: string;
    potrebnaTopota: number | null;
    dovedenaEnergija: number | null;
    celotnaEnergija: number | null;
    elektricnaEnergija: number | null;
    primaryEnergy: number | null;
    co2: number | null;
    kondicionirana: number | null;
  } | null;
}

export function AddressSearch() {
  const [address, setAddress] = useState("");
  const [delStavbe, setDelStavbe] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [submittedDel, setSubmittedDel] = useState<number | undefined>(undefined);

  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const handlePlaceSelect = useCallback(() => {
    const place = autocompleteRef.current?.getPlace();
    if (!place?.address_components) return;

    let street = "";
    let streetNumber = "";

    for (const comp of place.address_components) {
      if (comp.types.includes("route")) {
        street = comp.long_name;
      }
      if (comp.types.includes("street_number")) {
        streetNumber = comp.long_name;
      }
    }

    if (street && streetNumber) {
      setAddress(`${street} ${streetNumber}`);
    } else if (street) {
      setAddress(street);
    }
  }, []);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey || !inputRef.current) return;

    setOptions({ key: apiKey, v: "weekly" });

    importLibrary("places").then(() => {
      if (!inputRef.current) return;
      const ac = new google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: "si" },
        types: ["address"],
        fields: ["address_components"],
      });
      ac.addListener("place_changed", handlePlaceSelect);
      autocompleteRef.current = ac;
    });
  }, [handlePlaceSelect]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);

    const parsedDel = delStavbe.trim() ? parseInt(delStavbe, 10) : undefined;
    setSubmittedDel(parsedDel);

    try {
      const body: Record<string, unknown> = { address };
      if (parsedDel != null) {
        body.delStavbe = parsedDel;
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
            ref={inputRef}
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
          requestedDel={submittedDel}
        />
      )}
    </div>
  );
}
