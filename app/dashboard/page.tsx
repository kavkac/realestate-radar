import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import WatchlistSection from "@/components/dashboard/watchlist-section";
import HistorySection from "@/components/dashboard/history-section";
import SavedSearchesSection from "@/components/dashboard/saved-searches-section";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">
            Pozdravljeni{user?.firstName ? `, ${user.firstName}` : ""}
          </h1>
          <p className="text-sm text-gray-500 mt-1">Vaš pregled nepremičnin</p>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <WatchlistSection />
          <HistorySection />
          <SavedSearchesSection />
        </div>
      </div>
    </main>
  );
}
