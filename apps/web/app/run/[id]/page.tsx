import { notFound } from "next/navigation";
import { RunProgress } from "../../../components/RunProgress";
import { getStore } from "../../../lib/server";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: { id: string } }) {
  const store = getStore();
  const state = await store.read(params.id);
  if (!state) notFound();
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <RunProgress initial={state} />
    </main>
  );
}
