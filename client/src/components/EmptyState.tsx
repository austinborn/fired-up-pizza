import type { ReactNode } from 'react';

/**
 * A view that loaded but has nothing to list (ADR 0007 rule 5), e.g.
 * "No live orders". `children` can add a hint or a next step, such as a link
 * back to the menu. role="status" announces the result once loading ends.
 */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-stone-300 bg-white px-6 py-12 text-center"
    >
      <p className="font-semibold text-stone-800">{title}</p>
      {children ? <div className="mt-2 text-sm text-stone-600">{children}</div> : null}
    </div>
  );
}
