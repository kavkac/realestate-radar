"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { PropertyCard } from "./property-card";
import { PropertySkeleton } from "./property-skeleton";

interface Prostor {
  vrsta: string;
  povrsina: number | null;
}

interface LookupResult {
  success: boolean;
  error?: string;
  naslov?: string;
  lat?: number | null;
  lng?: number | null;
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
  parcele?: {
    parcelnaStevila: string;
    povrsina: number | null;
    vrstaRabe: string | null;
    boniteta: number | null;
    katastrskiRazred: number | null;
    katastrskiDohodek: number | null;
  }[];
  renVrednost?: {
    vrednost: number;
    datumOcene: string;
  } | null;
  etnAnaliza?: {
    steviloTransakcij: number;
    povprecnaCenaM2: number;
    minCenaM2: number;
    maxCenaM2: number;
    ocenjenaTrznaVrednost: number | null;
    trend: "rast" | "padec" | "stabilno" | null;
    zadnjeLeto: number | null;
    predLeto: number | null;
  } | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  "Address not found": "Naslova ni bilo mogoče najti v registru GURS. Preverite zapis naslova.",
  "Rate limit exceeded": "Preveč zahtev. Počakajte minuto in poskusite znova.",
  "GURS API error": "Napaka pri komunikaciji z GURS API. Poskusite čez nekaj sekund.",
  "No building found": "Na tem naslovu ni bila najdena nobena stavba v registru.",
};

function friendlyError(err: string): string {
  for (const [key, msg] of Object.entries(ERROR_MESSAGES)) {
    if (err.includes(key)) return msg;
  }
  return err || "Prišlo je do neznane napake. Poskusite znova.";
}

export function AddressSearch() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialAddress = searchParams.get("naslov") ?? "";
  const initialDel = searchParams.get("del") ?? "";

  const [address, setAddress] = useState(initialAddress);
  const [delStavbe, setDelStavbe] = useState(initialDel);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [submittedDel, setSubmittedDel] = useState<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);

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

  // Auto-search if address in URL on first load
  useEffect(() => {
    if (initialAddress && initialAddress.length >= 3) {
      performSearch(initialAddress, initialDel ? parseInt(initialDel, 10) : undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function performSearch(addr: string, del?: number) {
    setError(null);
    setResult(null);
    setLoading(true);
    setSubmittedDel(del);

    // Update URL
    const params = new URLSearchParams();
    params.set("naslov", addr);
    if (del != null) params.set("del", String(del));
    router.replace(`?${params.toString()}`, { scroll: false });

    try {
      const body: Record<string, unknown> = { address: addr };
      if (del != null) body.delStavbe = del;

      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data: LookupResult = await res.json();

      if (!data.success) {
        setError(friendlyError(data.error ?? "Napaka pri iskanju"));
        return;
      }

      setResult(data);
    } catch {
      setError("Napaka pri povezovanju s strežnikom. Preverite internetno povezavo.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedDel = delStavbe.trim() ? parseInt(delStavbe, 10) : undefined;
    await performSearch(address, parsedDel);
  }

  async function handleShare() {
    const url = new URL(window.location.href);
    url.searchParams.set("naslov", address);
    if (delStavbe.trim()) url.searchParams.set("del", delStavbe.trim());
    await navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-3" aria-label="Iskanje nepremičnine">
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="address-input">Vnesite naslov nepremičnine</label>
          <input
            id="address-input"
            ref={inputRef}
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="npr. Slovenčeva ulica 4, Ljubljana"
            className="flex-1 rounded-md border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={loading}
            autoComplete="off"
            aria-autocomplete="list"
          />
          <button
            type="submit"
            disabled={loading || address.length < 3}
            className="rounded-md bg-[#2d6a4f] px-5 py-3 text-sm font-medium text-white hover:bg-[#245a42] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            aria-label="Poišči nepremičnino"
          >
            {loading ? "Iščem…" : "Poišči"}
          </button>
        </div>

        <div className="flex gap-2">
          <label className="sr-only" htmlFor="del-input">Številka dela stavbe</label>
          <input
            id="del-input"
            type="number"
            min="1"
            value={delStavbe}
            onChange={(e) => setDelStavbe(e.target.value)}
            placeholder="Številka dela stavbe / stanovanja — neobvezno"
            className="flex-1 rounded-md border border-input bg-background px-4 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={loading}
          />
          {result?.success && (
            <button
              type="button"
              onClick={handleShare}
              title="Kopiraj delljivo povezavo"
              className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-[#2d6a4f] transition-colors"
              aria-label="Kopiraj delljivo povezavo"
            >
              {copied ? (
                <><span className="hidden sm:inline">Kopirano</span><span className="sm:hidden">OK</span></>
              ) : (
                <><span className="hidden sm:inline">Deli povezavo</span><span className="sm:hidden">Deli</span></>
              )}
            </button>
          )}
        </div>

        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </form>

      {loading && <PropertySkeleton />}

      {result?.success && result.naslov && result.stavba && (
        <PropertyCard
          naslov={result.naslov}
          enolicniId={result.enolicniId!}
          stavba={result.stavba}
          deliStavbe={result.deliStavbe ?? []}
          energetskaIzkaznica={result.energetskaIzkaznica ?? null}
          parcele={result.parcele}
          renVrednost={result.renVrednost}
          etnAnaliza={result.etnAnaliza}
          lat={result.lat}
          lng={result.lng}
          requestedDel={submittedDel}
        />
      )}
    </div>
  );
}
