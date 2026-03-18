"use client";

import { useState, useMemo } from "react";

export function CreditCalculator() {
  const [amount, setAmount] = useState(150000);
  const [years, setYears] = useState(20);
  const [rate, setRate] = useState("4.5");

  const result = useMemo(() => {
    const principal = amount;
    const annualRate = parseFloat(rate) / 100;
    const monthlyRate = annualRate / 12;
    const months = years * 12;

    if (monthlyRate === 0) {
      const monthly = principal / months;
      return { monthly, total: principal, interest: 0 };
    }

    const monthly =
      (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) /
      (Math.pow(1 + monthlyRate, months) - 1);
    const total = monthly * months;
    const interest = total - principal;

    return { monthly, total, interest };
  }, [amount, years, rate]);

  const fmt = (n: number) =>
    Math.round(n).toLocaleString("sl-SI", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  return (
    <div className="rounded-lg border border-gray-100 bg-white p-6 text-left">
      <h4 className="text-xs font-medium uppercase tracking-wider text-gray-500 border-l-4 border-gray-800 pl-3 mb-5">
        Kreditni kalkulator
      </h4>

      <div className="space-y-5">
        {/* Amount slider */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label
              htmlFor="credit-amount"
              className="text-sm text-gray-600"
            >
              Znesek kredita
            </label>
            <span className="text-sm font-medium text-gray-800 tabular-nums">
              {fmt(amount)} €
            </span>
          </div>
          <input
            id="credit-amount"
            type="range"
            min={10000}
            max={500000}
            step={5000}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#2d6a4f]"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>10.000 €</span>
            <span>500.000 €</span>
          </div>
        </div>

        {/* Duration select */}
        <div>
          <label htmlFor="credit-years" className="text-sm text-gray-600 block mb-1.5">
            Doba odplačevanja
          </label>
          <select
            id="credit-years"
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/20 focus:border-[#2d6a4f]"
          >
            {[5, 10, 15, 20, 25, 30].map((y) => (
              <option key={y} value={y}>
                {y} let
              </option>
            ))}
          </select>
        </div>

        {/* Interest rate */}
        <div>
          <label htmlFor="credit-rate" className="text-sm text-gray-600 block mb-1.5">
            Obrestna mera (% letno)
          </label>
          <input
            id="credit-rate"
            type="number"
            min="0.1"
            max="15"
            step="0.1"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/20 focus:border-[#2d6a4f] tabular-nums"
          />
        </div>

        {/* Results */}
        <div className="border-t border-gray-100 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-gray-500">Mesečni obrok</p>
              <p className="text-lg font-semibold text-gray-900 tabular-nums">
                {fmt(result.monthly)} €
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Skupaj plačano</p>
              <p className="text-sm font-medium text-gray-700 tabular-nums">
                {fmt(result.total)} €
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Skupaj obresti</p>
              <p className="text-sm font-medium text-gray-700 tabular-nums">
                {fmt(result.interest)} €
              </p>
            </div>
          </div>
        </div>

        {/* Disclaimer + CTA */}
        <div className="space-y-3">
          <p className="text-xs text-gray-400 leading-relaxed">
            Informativni izračun &mdash; za posvet z banko kontaktirajte svetovalca.
          </p>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-400 cursor-not-allowed">
              Zahtevaj posvet
            </span>
            <span className="text-xs font-semibold text-gray-400">
              Kmalu
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
