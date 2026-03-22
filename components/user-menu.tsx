"use client";
import { useUser, useClerk } from "@clerk/nextjs";
import { useState, useRef, useEffect } from "react";

export function UserMenu() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!user) return null;

  const initials = [user.firstName, user.lastName]
    .filter(Boolean)
    .map(n => n![0].toUpperCase())
    .join("") || user.emailAddresses[0]?.emailAddress[0].toUpperCase() || "?";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-center text-[11px] font-semibold text-gray-600"
      >
        {initials}
      </button>
      {open && (
        <div className="absolute right-0 top-9 w-48 bg-white border border-gray-100 rounded-xl shadow-lg py-1 z-50">
          <div className="px-3 py-2 border-b border-gray-50">
            <p className="text-xs font-medium text-gray-800 truncate">{user.firstName} {user.lastName}</p>
            <p className="text-[10px] text-gray-400 truncate">{user.emailAddresses[0]?.emailAddress}</p>
          </div>
          <button
            onClick={() => signOut({ redirectUrl: "/" })}
            className="w-full text-left px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Odjava
          </button>
        </div>
      )}
    </div>
  );
}
