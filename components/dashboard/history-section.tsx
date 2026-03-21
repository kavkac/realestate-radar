"use client";
import { useEffect, useState } from "react";

interface HistoryItem {
  id: number;
  stavba_id: string;
  data: { naslov?: string; ogledanAt?: string };
}

export default function HistorySection() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/saved?type=history")
      .then((r) => r.json())
      .then((d) => { setItems(d.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-base font-semibold text-gray-900 mb-3">🕐 Zgodovina ogledov</h2>
      {loading ? (
        <p className="text-sm text-gray-400">Nalagam...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400">Še nimate zgodovine iskanj.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between text-sm">
              <span className="text-gray-800">{item.data?.naslov ?? item.stavba_id}</span>
              <span className="text-gray-400 text-xs">
                {item.data?.ogledanAt ? new Date(item.data.ogledanAt).toLocaleDateString("sl-SI") : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
