import { notFound } from "next/navigation";
import { RunProgress } from "../../../components/RunProgress";
import { getStore } from "../../../lib/server";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: { id: string } }) {
  const store = getStore();
  const state = await store.read(params.id);
  if (!state) notFound();
  return (
    <main className="min-h-screen bg-zinc-50 px-5 py-6 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <RunProgress initial={state} />
      </div>
    </main>
  );
}
