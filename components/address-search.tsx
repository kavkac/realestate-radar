"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { PropertyCard } from "./property-card";
import { PropertySkeleton } from "./property-skeleton";
import { LoadingProgress } from "./loading-progress";

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

type PropertyTab = {
  id: string;
  naslov: string;
  del?: number;
  data: LookupResult | null;
  loading: boolean;
  error: string | null;
};

const MAX_TABS = 5;

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

function truncateAddress(naslov: string, max = 20): string {
  if (naslov.length <= max) return naslov;
  return naslov.slice(0, max) + "\u2026";
}

export function AddressSearch() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialAddress = searchParams.get("naslov") ?? "";
  const initialDel = searchParams.get("del") ?? "";

  const [address, setAddress] = useState(initialAddress);
  const [delStavbe, setDelStavbe] = useState(initialDel);
  const [copied, setCopied] = useState(false);

  const [tabs, setTabs] = useState<PropertyTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

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
      performSearch(initialAddress, initialDel ? parseInt(initialDel, 10) : undefined, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateUrl(addr: string, del?: number) {
    const params = new URLSearchParams();
    params.set("naslov", addr);
    if (del != null) params.set("del", String(del));
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  async function performSearch(addr: string, del?: number, forceNew = false) {
    const shouldCreateNew = forceNew || addingNew || tabs.length === 0;

    if (shouldCreateNew) {
      // Create new tab
      const newId = String(Date.now());
      const newTab: PropertyTab = {
        id: newId,
        naslov: addr,
        del,
        data: null,
        loading: true,
        error: null,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newId);
      setAddingNew(false);
      updateUrl(addr, del);

      try {
        const body: Record<string, unknown> = { address: addr };
        if (del != null) body.delStavbe = del;

        const res = await fetch("/api/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data: LookupResult = await res.json();

        setTabs((prev) =>
          prev.map((t) =>
            t.id === newId
              ? {
                  ...t,
                  loading: false,
                  data: data.success ? data : null,
                  error: data.success ? null : friendlyError(data.error ?? "Napaka pri iskanju"),
                  naslov: data.naslov ?? addr,
                }
              : t
          )
        );
      } catch {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === newId
              ? {
                  ...t,
                  loading: false,
                  error: "Napaka pri povezovanju s strežnikom. Preverite internetno povezavo.",
                }
              : t
          )
        );
      }
    } else {
      // Replace current tab's data
      const currentId = activeTabId!;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === currentId
            ? { ...t, naslov: addr, del, data: null, loading: true, error: null }
            : t
        )
      );
      updateUrl(addr, del);

      try {
        const body: Record<string, unknown> = { address: addr };
        if (del != null) body.delStavbe = del;

        const res = await fetch("/api/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data: LookupResult = await res.json();

        setTabs((prev) =>
          prev.map((t) =>
            t.id === currentId
              ? {
                  ...t,
                  loading: false,
                  data: data.success ? data : null,
                  error: data.success ? null : friendlyError(data.error ?? "Napaka pri iskanju"),
                  naslov: data.naslov ?? addr,
                }
              : t
          )
        );
      } catch {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === currentId
              ? {
                  ...t,
                  loading: false,
                  error: "Napaka pri povezovanju s strežnikom. Preverite internetno povezavo.",
                }
              : t
          )
        );
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedDel = delStavbe.trim() ? parseInt(delStavbe, 10) : undefined;
    await performSearch(address, parsedDel);
  }

  function handleSwitchTab(tabId: string) {
    setActiveTabId(tabId);
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      setAddress(tab.naslov);
      setDelStavbe(tab.del != null ? String(tab.del) : "");
      updateUrl(tab.naslov, tab.del);
    }
    setAddingNew(false);
  }

  function handleCloseTab(tabId: string) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (tabId === activeTabId) {
        // Switch to previous tab, or next, or clear
        const closedIdx = prev.findIndex((t) => t.id === tabId);
        const newActive = next[Math.min(closedIdx, next.length - 1)] ?? null;
        setActiveTabId(newActive?.id ?? null);
        if (newActive) {
          setAddress(newActive.naslov);
          setDelStavbe(newActive.del != null ? String(newActive.del) : "");
          updateUrl(newActive.naslov, newActive.del);
        } else {
          setAddress("");
          setDelStavbe("");
          router.replace("?", { scroll: false });
        }
      }
      return next;
    });
  }

  function handleAddTab() {
    if (tabs.length >= MAX_TABS) return;
    setAddingNew(true);
    setAddress("");
    setDelStavbe("");
    inputRef.current?.focus();
  }

  async function handleShare() {
    const url = new URL(window.location.href);
    if (activeTab) {
      url.searchParams.set("naslov", activeTab.naslov);
      if (activeTab.del != null) url.searchParams.set("del", String(activeTab.del));
    }
    await navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isLoading = activeTab?.loading ?? false;
  const showShareButton = activeTab?.data?.success ?? false;

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-3" aria-label="Iskanje nepremičnine">
        {/* Desktop: vse v eni vrstici | Mobile: vsako v svoji */}
        <div className="flex flex-col sm:flex-row gap-2">
          <label className="sr-only" htmlFor="address-input">Vnesite naslov nepremičnine</label>
          <div className="relative flex-1">
            <input
              id="address-input"
              ref={inputRef}
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="npr. Slovenčeva ulica 4, Ljubljana"
              className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={isLoading}
              autoComplete="off"
              aria-autocomplete="list"
            />
          </div>
          <label className="sr-only" htmlFor="del-input">Številka dela stavbe</label>
          <input
            id="del-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={delStavbe}
            onChange={(e) => setDelStavbe(e.target.value.replace(/\D/g, ""))}
            placeholder="Št. dela stavbe (neobvezno)"
            className="sm:w-32 rounded-md border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [appearance:textfield]"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || address.length < 3}
            className="rounded-md bg-[#2d6a4f] px-5 py-3 text-sm font-medium text-white hover:bg-[#245a42] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            aria-label="Poišči nepremičnino"
          >
            {isLoading ? "Iščem\u2026" : "Poišči"}
          </button>
        </div>



        {activeTab?.error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {activeTab.error}
          </div>
        )}
      </form>

      {/* Tab bar + card wrapper — no gap between tabs and card */}
      {tabs.length > 0 && (
        <div>
          <div className="relative bg-gray-50 border-b border-gray-200 px-4 pt-3 pb-0 flex items-end gap-1 overflow-x-auto scrollbar-none">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId && !addingNew;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleSwitchTab(tab.id)}
                  className={`group relative flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors min-w-[120px] max-w-[220px] ${
                    isActive
                      ? "border-t-2 border-t-[#2d6a4f] border-l border-r border-gray-200 border-b-0 bg-white text-[#1a1a1a] z-10 -mb-px"
                      : "border border-gray-200 bg-gray-100 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                  }`}
                >
                  <span className="truncate">{truncateAddress(tab.naslov || "Iskanje\u2026")}</span>
                  {tab.loading && (
                    <span className="inline-block h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-gray-300 border-t-[#2d6a4f]" />
                  )}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(tab.id);
                    }}
                    className={`ml-1 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-xs cursor-pointer transition-opacity ${
                      isActive
                        ? "text-gray-400 hover:bg-gray-200 hover:text-gray-700 opacity-100"
                        : "text-gray-400 hover:bg-gray-200 hover:text-gray-700 opacity-0 group-hover:opacity-100"
                    }`}
                    role="button"
                    aria-label={`Zapri ${tab.naslov}`}
                  >
                    &times;
                  </span>
                </button>
              );
            })}
            {tabs.length < MAX_TABS && (
              <button
                onClick={handleAddTab}
                className="flex-shrink-0 ml-2 border border-gray-200 bg-white rounded-md px-2.5 py-1.5 text-sm text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors mb-1"
                title="Dodaj nepremičnino"
                aria-label="Dodaj novo nepremičnino"
              >
                +
              </button>
            )}
          </div>

          {activeTab?.loading && <LoadingProgress />}

          {activeTab?.data?.success && activeTab.data.naslov && activeTab.data.stavba && (
            <PropertyCard
              naslov={activeTab.data.naslov}
              enolicniId={activeTab.data.enolicniId!}
              stavba={activeTab.data.stavba}
              deliStavbe={activeTab.data.deliStavbe ?? []}
              energetskaIzkaznica={activeTab.data.energetskaIzkaznica ?? null}
              parcele={activeTab.data.parcele}
              renVrednost={activeTab.data.renVrednost}
              etnAnaliza={activeTab.data.etnAnaliza}
              lat={activeTab.data.lat}
              lng={activeTab.data.lng}
              requestedDel={activeTab.del}
            />
          )}
        </div>
      )}
    </div>
  );
}
