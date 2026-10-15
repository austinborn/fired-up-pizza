/**
 * A view's loading state (ADR 0007 rule 5). role="status" makes screen
 * readers announce the label without interrupting.
 */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-12 text-stone-600">
      <span
        aria-hidden="true"
        className="size-5 rounded-full border-2 border-stone-300 border-t-orange-600 motion-safe:animate-spin"
      />
      <span>{label}</span>
    </div>
  );
}
