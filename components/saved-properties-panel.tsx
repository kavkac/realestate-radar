"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface SavedProperty {
  id: number;
  stavba_id: string;
  data: {
    naslov?: string;
    vrednostMin?: number;
    vrednostMax?: number;
  };
  created_at: string;
}

interface SavedPropertiesPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SavedPropertiesPanel({ isOpen, onClose }: SavedPropertiesPanelProps) {
  const [items, setItems] = useState<SavedProperty[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/saved?type=watchlist");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchItems();
    }
  }, [isOpen, fetchItems]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

  const handleRemove = async (stavbaId: string) => {
    // Optimistic UI
    setItems((prev) => prev.filter((item) => item.stavba_id !== stavbaId));
    try {
      await fetch("/api/saved", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "watchlist", stavba_id: stavbaId }),
      });
    } catch {
      // Refetch on error
      fetchItems();
    }
  };

  const formatValue = (min?: number, max?: number) => {
    if (!min && !max) return null;
    const fmt = (n: number) => n.toLocaleString("sl-SI") + " €";
    if (min && max && min !== max) return `${fmt(min)} – ${fmt(max)}`;
    return fmt(min || max || 0);
  };

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="absolute top-full right-0 mt-2 w-80 sm:w-96 max-h-[400px] overflow-y-auto bg-white rounded-lg shadow-lg z-50"
    >
      <div className="p-4 border-b border-gray-100">
        <h3 className="font-semibold text-gray-800 text-sm">Shranjene nepremičnine</h3>
      </div>

      {loading ? (
        <div className="p-6 text-center text-gray-400 text-sm">Nalaganje...</div>
      ) : items.length === 0 ? (
        <div className="p-6 text-center text-gray-400 text-sm">
          Shranjene nepremičnine se bodo pojavile tukaj
        </div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {items.map((item) => (
            <li key={item.id} className="px-4 py-3 hover:bg-gray-50 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 truncate">
                  {item.data?.naslov || item.stavba_id}
                </p>
                {formatValue(item.data?.vrednostMin, item.data?.vrednostMax) && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {formatValue(item.data?.vrednostMin, item.data?.vrednostMax)}
                  </p>
                )}
              </div>
              <button
                onClick={() => handleRemove(item.stavba_id)}
                className="flex-shrink-0 text-gray-400 hover:text-red-500 transition-colors p-1"
                title="Odstrani"
                aria-label="Odstrani iz shranjenih"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function useSavedProperties() {
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const fetchSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/saved?type=watchlist");
      if (res.ok) {
        const data = await res.json();
        const ids = new Set<string>((data.items || []).map((item: SavedProperty) => item.stavba_id));
        setSavedIds(ids);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSaved();
  }, [fetchSaved]);

  const toggleSave = async (stavbaId: string, data: { naslov: string; vrednostMin?: number; vrednostMax?: number }) => {
    const isSaved = savedIds.has(stavbaId);

    // Optimistic update
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (isSaved) {
        next.delete(stavbaId);
      } else {
        next.add(stavbaId);
      }
      return next;
    });

    try {
      if (isSaved) {
        await fetch("/api/saved", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "watchlist", stavba_id: stavbaId }),
        });
      } else {
        await fetch("/api/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "watchlist", stavba_id: stavbaId, data }),
        });
      }
    } catch {
      // Revert on error
      fetchSaved();
    }
  };

  const isSaved = (stavbaId: string) => savedIds.has(stavbaId);
  const count = savedIds.size;

  return { isSaved, toggleSave, count, loading, refetch: fetchSaved };
}
