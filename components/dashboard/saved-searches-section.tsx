"use client";
import { useEffect, useState } from "react";

interface SearchItem {
  id: number;
  data: { query?: string; filters?: Record<string, unknown> };
  created_at: string;
}

export default function SavedSearchesSection() {
  const [items, setItems] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/saved?type=search")
      .then((r) => r.json())
      .then((d) => { setItems(d.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-base font-semibold text-gray-900 mb-3">🔍 Shranjene iskanje</h2>
      {loading ? (
        <p className="text-sm text-gray-400">Nalagam...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400">Shranjene iskalne filtre bodo tukaj. (Kmalu)</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id} className="text-sm text-gray-800">
              {item.data?.query ?? JSON.stringify(item.data?.filters)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
