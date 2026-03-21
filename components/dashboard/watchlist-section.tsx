"use client";
import { useEffect, useState } from "react";

interface SavedItem {
  id: number;
  stavba_id: string;
  data: { naslov?: string; vrednostMin?: number; vrednostMax?: number };
  created_at: string;
}

export default function WatchlistSection() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/saved?type=watchlist")
      .then((r) => r.json())
      .then((d) => { setItems(d.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-base font-semibold text-gray-900 mb-3">📌 Watchlist</h2>
      {loading ? (
        <p className="text-sm text-gray-400">Nalagam...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400">Še nimate shranjenih nepremičnin. Poiščite naslov in kliknite ★.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between text-sm">
              <span className="text-gray-800">{item.data?.naslov ?? item.stavba_id}</span>
              {item.data?.vrednostMin && (
                <span className="text-gray-500">
                  {Math.round(item.data.vrednostMin / 1000)}k – {Math.round((item.data.vrednostMax ?? 0) / 1000)}k €
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
