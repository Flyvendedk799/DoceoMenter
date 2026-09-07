import { notFound } from "next/navigation";
import { RunProgress } from "../../../components/RunProgress";
import { getStore } from "../../../lib/server";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: { id: string } }) {
  const store = getStore();
  const state = await store.read(params.id);
  if (!state) notFound();
  return (
    <main className="min-h-screen bg-ink-900 text-fg">
      <div className="mx-auto max-w-[1180px] px-5 pb-28 pt-14 sm:px-7">
        <RunProgress initial={state} />
      </div>
    </main>
  );
}
