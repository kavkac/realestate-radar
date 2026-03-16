interface PropertyCardProps {
  naslov: string;
  enolicniId: { koId: number; stStavbe: number; stDelaStavbe: number | null };
  stavba: {
    letoIzgradnje: number | null;
    letoObnove: { fasade: number | null; strehe: number | null };
    steviloEtaz: number | null;
    steviloStanovanj: number | null;
    povrsina: number | null;
    konstrukcija: string | null;
    tip: string | null;
    prikljucki: {
      elektrika: boolean;
      plin: boolean;
      vodovod: boolean;
      kanalizacija: boolean;
    };
  };
  deliStavbe: {
    stDela: number;
    povrsina: number | null;
    uporabnaPovrsina: number | null;
    vrsta: string | null;
  }[];
  energetskaIzkaznica: {
    razred: string;
    datumIzdaje: string;
    veljaDo: string;
    potrebnaTopota: number | null;
    primaryEnergy: number | null;
    co2: number | null;
    povrsina: number | null;
  } | null;
}

const ENERGY_COLORS: Record<string, string> = {
  A1: "bg-green-600",
  A2: "bg-green-500",
  B1: "bg-lime-500",
  B2: "bg-lime-400",
  C: "bg-yellow-400 text-black",
  D: "bg-amber-400 text-black",
  E: "bg-orange-500",
  F: "bg-red-500",
  G: "bg-red-700",
};

function Check({ on }: { on: boolean }) {
  return <span className={on ? "text-green-600" : "text-red-400"}>{on ? "\u2713" : "\u2717"}</span>;
}

export function PropertyCard({
  naslov,
  enolicniId,
  stavba,
  deliStavbe,
  energetskaIzkaznica,
}: PropertyCardProps) {
  const idStr = [
    enolicniId.koId,
    enolicniId.stStavbe,
    enolicniId.stDelaStavbe,
  ]
    .filter((v) => v != null)
    .join(" / ");

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden text-left">
      {/* Header */}
      <div className="bg-[#2d6a4f] px-6 py-4 text-white">
        <h3 className="text-lg font-semibold">{naslov}</h3>
        <p className="text-sm text-green-200">KO / stavba / del: {idStr}</p>
      </div>

      <div className="p-6 space-y-6">
        {/* Podatki o stavbi */}
        <section>
          <h4 className="text-sm font-semibold text-[#2d6a4f] uppercase tracking-wide mb-3">
            Podatki o stavbi
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            <Field label="Leto izgradnje" value={stavba.letoIzgradnje} />
            <Field label="Obnova fasade" value={stavba.letoObnove.fasade} />
            <Field label="Obnova strehe" value={stavba.letoObnove.strehe} />
            <Field label="Etaže" value={stavba.steviloEtaz} />
            <Field label="Stanovanj" value={stavba.steviloStanovanj} />
            <Field
              label="Bruto površina"
              value={stavba.povrsina != null ? `${stavba.povrsina} m\u00B2` : null}
            />
            <Field label="Tip stavbe" value={stavba.tip} />
            <Field label="Konstrukcija" value={stavba.konstrukcija} />
          </div>
        </section>

        {/* Priključki */}
        <section>
          <h4 className="text-sm font-semibold text-[#2d6a4f] uppercase tracking-wide mb-3">
            Priključki
          </h4>
          <div className="flex flex-wrap gap-4 text-sm">
            <span><Check on={stavba.prikljucki.elektrika} /> Elektrika</span>
            <span><Check on={stavba.prikljucki.plin} /> Plin</span>
            <span><Check on={stavba.prikljucki.vodovod} /> Vodovod</span>
            <span><Check on={stavba.prikljucki.kanalizacija} /> Kanalizacija</span>
          </div>
        </section>

        {/* Deli stavbe */}
        {deliStavbe.length > 0 && (
          <section>
            <h4 className="text-sm font-semibold text-[#2d6a4f] uppercase tracking-wide mb-3">
              Deli stavbe ({deliStavbe.length})
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Št. dela</th>
                    <th className="pb-2 pr-4">Površina</th>
                    <th className="pb-2 pr-4">Uporabna površina</th>
                    <th className="pb-2">Vrsta</th>
                  </tr>
                </thead>
                <tbody>
                  {deliStavbe.map((d) => (
                    <tr key={d.stDela} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{d.stDela}</td>
                      <td className="py-2 pr-4">
                        {d.povrsina != null ? `${d.povrsina} m\u00B2` : "\u2014"}
                      </td>
                      <td className="py-2 pr-4">
                        {d.uporabnaPovrsina != null ? `${d.uporabnaPovrsina} m\u00B2` : "\u2014"}
                      </td>
                      <td className="py-2">{d.vrsta ?? "\u2014"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Energetska izkaznica */}
        <section>
          <h4 className="text-sm font-semibold text-[#2d6a4f] uppercase tracking-wide mb-3">
            Energetska izkaznica
          </h4>
          {energetskaIzkaznica ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-bold text-white ${ENERGY_COLORS[energetskaIzkaznica.razred] ?? "bg-gray-400"}`}
                >
                  {energetskaIzkaznica.razred}
                </span>
                <span className="text-sm text-muted-foreground">
                  Veljavna do {energetskaIzkaznica.veljaDo}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                <Field
                  label="Potrebna toplota"
                  value={
                    energetskaIzkaznica.potrebnaTopota != null
                      ? `${energetskaIzkaznica.potrebnaTopota} kWh/m\u00B2a`
                      : null
                  }
                />
                <Field
                  label="Primarna energija"
                  value={
                    energetskaIzkaznica.primaryEnergy != null
                      ? `${energetskaIzkaznica.primaryEnergy} kWh/m\u00B2a`
                      : null
                  }
                />
                <Field
                  label="CO\u2082 emisije"
                  value={
                    energetskaIzkaznica.co2 != null
                      ? `${energetskaIzkaznica.co2} kg/m\u00B2a`
                      : null
                  }
                />
                <Field
                  label="Površina"
                  value={
                    energetskaIzkaznica.povrsina != null
                      ? `${energetskaIzkaznica.povrsina} m\u00B2`
                      : null
                  }
                />
                <Field label="Datum izdaje" value={energetskaIzkaznica.datumIzdaje} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Ni energetske izkaznice
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  if (value == null) return null;
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className="font-medium">{value}</p>
    </div>
  );
}
