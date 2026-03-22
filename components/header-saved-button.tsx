"use client";

import { useState, useEffect, useCallback } from "react";
import { SavedPropertiesPanel } from "./saved-properties-panel";

interface SavedProperty {
  id: number;
  stavba_id: string;
}

export function HeaderSavedButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/saved?type=watchlist");
      if (res.ok) {
        const data = await res.json();
        setCount((data.items || []).length);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  // Refetch count when panel closes (in case items were removed)
  useEffect(() => {
    if (!isOpen) {
      fetchCount();
    }
  }, [isOpen, fetchCount]);

  // Listen for custom event when property is saved/unsaved
  useEffect(() => {
    const handler = () => fetchCount();
    window.addEventListener("saved-properties-changed", handler);
    return () => window.removeEventListener("saved-properties-changed", handler);
  }, [fetchCount]);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors px-2 py-1 rounded hover:bg-gray-50"
        title="Shranjene nepremičnine"
        aria-label="Shranjene nepremičnine"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill={count > 0 ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
        <span className="hidden sm:inline text-xs font-medium">Shranjeni</span>
        {count > 0 && (
          <span className="text-[10px] text-gray-500 font-medium">
            {count}
          </span>
        )}
      </button>

      <SavedPropertiesPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </div>
  );
}
