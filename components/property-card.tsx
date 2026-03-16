interface PropertyCardProps {
  address: string;
  municipality?: string;
  postCode?: string;
  yearBuilt?: number;
  grossArea?: number;
  energyClass?: string;
  lastTransactionPrice?: number;
  lastTransactionDate?: string;
}

export function PropertyCard({
  address,
  municipality,
  postCode,
  yearBuilt,
  grossArea,
  energyClass,
  lastTransactionPrice,
  lastTransactionDate,
}: PropertyCardProps) {
  return (
    <div className="rounded-lg border bg-card p-6 space-y-4 text-left">
      <div>
        <h3 className="text-lg font-semibold">{address}</h3>
        {municipality && postCode && (
          <p className="text-sm text-muted-foreground">
            {postCode} {municipality}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        {yearBuilt && (
          <div>
            <span className="text-muted-foreground">Leto gradnje</span>
            <p className="font-medium">{yearBuilt}</p>
          </div>
        )}
        {grossArea && (
          <div>
            <span className="text-muted-foreground">Bruto površina</span>
            <p className="font-medium">{grossArea} m²</p>
          </div>
        )}
        {energyClass && (
          <div>
            <span className="text-muted-foreground">Energetski razred</span>
            <p className="font-medium">{energyClass}</p>
          </div>
        )}
        {lastTransactionPrice && (
          <div>
            <span className="text-muted-foreground">Zadnja transakcija</span>
            <p className="font-medium">
              {lastTransactionPrice.toLocaleString("sl-SI")} €
              {lastTransactionDate && (
                <span className="text-muted-foreground ml-1">
                  ({lastTransactionDate})
                </span>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
