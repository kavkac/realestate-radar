"use client";

import { useState, useEffect } from "react";

const STEPS = [
  { label: "Iščem naslov v registru naslovov (GURS RPE)…", delay: 0 },
  { label: "Pridobivam podatke iz katastra nepremičnin…", delay: 800 },
  { label: "Iščem energetsko izkaznico (MOP)…", delay: 1800 },
  { label: "Pridobivam podatke o lastništvu in parcelah…", delay: 2800 },
  { label: "Sestavljam poročilo o nepremičnini…", delay: 3800 },
];

export function LoadingProgress() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timers = STEPS.slice(1).map((step, i) =>
      setTimeout(() => setActiveIndex(i + 1), step.delay),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-md">
      <ul className="space-y-3" role="status" aria-label="Pridobivam podatke">
        {STEPS.map((step, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <li key={i} className="flex items-center gap-3 text-sm">
              {done ? (
                <span className="flex h-2.5 w-2.5 items-center justify-center text-green-500">
                  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              ) : active ? (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                </span>
              ) : (
                <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
              )}
              <span
                className={
                  done
                    ? "text-gray-400"
                    : active
                      ? "font-medium text-gray-900"
                      : "text-gray-300"
                }
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-gray-400">
        Podatki se pridobivajo neposredno iz uradnih registrov.
      </p>
    </div>
  );
}
