/**
 * Temporary content for pages whose work item has not landed yet. Each page
 * replaces its placeholder in place; delete this component once nothing uses it.
 */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-stone-600">{description}</p>
      <p className="text-sm text-stone-500">Coming soon.</p>
    </section>
  );
}
