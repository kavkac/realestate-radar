"use client";

import { useState } from "react";

export function AddressSearch() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error ?? "Napaka pri iskanju");
        return;
      }

      // TODO: Navigate to results or display property card
      console.log("Rezultat:", data);
    } catch {
      setError("Napaka pri povezovanju s strežnikom");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Ulica in hišna številka, npr. Slovenska cesta 35"
          className="flex-1 rounded-md border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || address.length < 3}
          className="rounded-md bg-brand-500 px-6 py-3 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Iščem..." : "Poišči"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </form>
  );
}
