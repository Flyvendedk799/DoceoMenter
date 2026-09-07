import { notFound } from "next/navigation";
import { OutputsViewer } from "../../../../components/OutputsViewer";
import { getStore } from "../../../../lib/server";

export const dynamic = "force-dynamic";

export default async function OutputsPage({ params }: { params: { id: string } }) {
  const store = getStore();
  const state = await store.read(params.id);
  if (!state) notFound();

  return (
    <main className="min-h-screen bg-ink-900 text-fg">
      <OutputsViewer state={state} />
    </main>
  );
}
