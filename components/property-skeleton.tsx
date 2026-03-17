"use client";

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-muted ${className}`}
      aria-hidden="true"
    />
  );
}

export function PropertySkeleton() {
  return (
    <div
      className="rounded-xl border bg-card shadow-sm overflow-hidden"
      aria-label="Nalagam podatke o nepremičnini…"
      aria-busy="true"
      role="status"
    >
      {/* Header skeleton */}
      <div className="bg-[#2d6a4f]/20 px-6 py-4 space-y-2">
        <SkeletonBlock className="h-5 w-2/3" />
        <SkeletonBlock className="h-3 w-1/3" />
      </div>

      <div className="p-6 space-y-6">
        {/* Building data */}
        <div className="space-y-3">
          <SkeletonBlock className="h-4 w-32" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <SkeletonBlock className="h-3 w-20" />
                <SkeletonBlock className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>

        {/* Priključki */}
        <div className="space-y-3">
          <SkeletonBlock className="h-4 w-24" />
          <div className="flex gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonBlock key={i} className="h-4 w-20" />
            ))}
          </div>
        </div>

        {/* Energy certificate */}
        <div className="space-y-3">
          <SkeletonBlock className="h-4 w-40" />
          <div className="flex items-center gap-4">
            <SkeletonBlock className="h-14 w-14 rounded-lg" />
            <div className="space-y-2 flex-1">
              <SkeletonBlock className="h-4 w-1/2" />
              <SkeletonBlock className="h-3 w-1/3" />
            </div>
          </div>
        </div>

        {/* Value section */}
        <div className="space-y-3">
          <SkeletonBlock className="h-4 w-36" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <SkeletonBlock className="h-3 w-20" />
                <SkeletonBlock className="h-5 w-24" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="sr-only">Pridobivam podatke iz GURS…</p>
    </div>
  );
}
