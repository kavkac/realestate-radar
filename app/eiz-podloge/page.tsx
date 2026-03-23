"use client";

/**
 * /eiz-podloge?eid=<eidStavba>&lat=<lat>&lng=<lng>[&del=<eidDelStavbe>]
 *
 * EIZ Pre-fill page for certified energy auditors.
 * Shows full structured data package with provenance per field.
 * Auditor can override values and export.
 *
 * TODO: Add auth guard (require logged-in user or auditor token)
 */

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { EizAuditorReport } from "@/components/eiz-auditor-report";
import { LoadingProgress } from "@/components/loading-progress";
import type { EizPrefillReport } from "@/lib/eiz-prefill";

function EizPodlogeContent() {
  const params = useSearchParams();
  const eid = params.get("eid");
  const lat = params.get("lat");
  const lng = params.get("lng");
  const del = params.get("del");
  const naslov = params.get("naslov");

  const [report, setReport] = useState<EizPrefillReport | null>(null);
  const [loading, setLoading] = useState(true); // true = nalagam takoj
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eid || !lat || !lng) return;
    setLoading(true);
    setError(null);

    const url = `/api/eiz-prefill?eid=${eid}&lat=${lat}&lng=${lng}${del ? `&del=${del}` : ""}${naslov ? `&naslov=${encodeURIComponent(naslov)}` : ""}`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setReport(data);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [eid, lat, lng, del]);

  if (!eid || !lat || !lng) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center px-4">
        <h1 className="text-xl font-bold text-gray-900 mb-2">EIZ Podloge</h1>
        <p className="text-gray-500 text-sm mb-4">
          Ta stran generira predizpolnjene podatke za pripravo energetske izkaznice.
        </p>
        <p className="text-xs text-gray-400">
          Uporaba: <code className="bg-gray-100 px-1 rounded">/eiz-podloge?eid=&lt;EID&gt;&lat=&lt;lat&gt;&lng=&lt;lng&gt;</code>
        </p>
        <p className="text-xs text-gray-400 mt-2">
          EID stavbe najdete na <a href="/" className="text-blue-600 underline">RealEstateRadar</a> pri vsakem objektu.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gray-50">
        <p className="text-sm font-medium text-gray-700 mb-6">Pripravljam podloge za energetsko izkaznico…</p>
        <LoadingProgress steps={[
          "Pridobivam podatke iz GURS (REN, EVS)…",
          "Iščem energetsko izkaznico (MOP register)…",
          "Nalagam klimatske podatke (ARSO, Open-Meteo ERA5)…",
          "Računam toplotno ovojnico (TABULA SLO)…",
          "Sestavljam podloge za energetičarja…",
        ]} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center px-4">
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700 font-medium">Napaka pri generiranju podlog</p>
          <p className="text-red-500 text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="px-4 py-6">
      <EizAuditorReport report={report} />
    </div>
  );
}

export default function EizPodlogePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-400 text-sm">Nalagam…</div>}>
      <EizPodlogeContent />
    </Suspense>
  );
}
