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
        className="flex items-center gap-1 px-2 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-gray-100 transition-colors"
        title="Shranjene nepremičnine"
        aria-label="Shranjene nepremičnine"
      >
        <svg
          className="w-5 h-5"
          fill={count > 0 ? "currentColor" : "none"}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
          />
        </svg>
        {count > 0 && (
          <span className="text-xs font-medium bg-brand-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {count}
          </span>
        )}
      </button>

      <SavedPropertiesPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </div>
  );
}
