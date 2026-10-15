import { useId, useState } from 'react';
import { errorMessage } from '../../api/http';
import { useAsync } from '../../hooks/useAsync';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import { LoadingState } from '../LoadingState';
import { MENU_SECONDARY_BUTTON } from './menu-button-class';
import { isNameConflict, type CatalogRow, type MenuCatalog } from './menu-catalog';
import { MenuCatalogForm } from './MenuCatalogForm';
import { MenuCatalogRow } from './MenuCatalogRow';

/** Rows saved since `basis` loaded. They show over it until the next list arrives. */
interface SavedRows<Row> {
  basis: Row[] | undefined;
  rows: Row[];
}

/**
 * One catalog on the staff menu page, menu items or toppings: every row,
 * hidden ones included, and a form to add one (ADR 0007 rule 5).
 * - The list loads once. It is not a live view, so it does not poll (ADR 0007
 *   rule 4). It has loading, empty, and error-with-retry states, and a stale
 *   state when a reload fails while rows are on screen.
 * - After every save the server's copy of the row shows at once, a status
 *   message says what happened, and the list loads again, which puts a new or
 *   renamed row in its sorted place and brings in other staff's changes.
 * - A save that fails with 409 CONFLICT, because another row has the name,
 *   also loads the list again: this page's copy is out of date.
 */
export function MenuCatalogSection<Row extends CatalogRow, Values extends object>({
  catalog,
}: {
  catalog: MenuCatalog<Row, Values>;
}) {
  const headingId = useId();
  const createHeadingId = useId();
  const { data, error, reload } = useAsync((signal) => catalog.list({ signal }), [catalog]);
  const [message, setMessage] = useState('');

  // Every save reloads the list, so the next list to arrive already has the
  // saved rows, and the overlay starts over.
  const [saved, setSaved] = useState<SavedRows<Row>>({ basis: data, rows: [] });
  if (saved.basis !== data) {
    setSaved({ basis: data, rows: [] });
  }
  const rows =
    data === undefined ? undefined : withSaved(data, saved.basis === data ? saved.rows : []);

  function handleSaved(row: Row, text: string) {
    setSaved((previous) => ({
      basis: previous.basis,
      rows: [...previous.rows.filter((savedRow) => savedRow.id !== row.id), row],
    }));
    setMessage(text);
    reload();
  }

  async function create(values: Values) {
    let row: Row;
    try {
      row = await catalog.create(values);
    } catch (reason) {
      if (isNameConflict(reason)) {
        reload();
      }
      throw reason;
    }
    handleSaved(row, `Added ${row.name}.`);
  }

  const things = catalog.title.toLowerCase();
  let list;
  if (rows === undefined) {
    list =
      error === null ? (
        <LoadingState label={`Loading ${things}…`} />
      ) : (
        <ErrorState title={`Couldn't load the ${things}`} error={error} onRetry={reload} />
      );
  } else {
    list = (
      <div className="space-y-3">
        {error === null ? null : (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <p>
              <span className="font-semibold">Couldn&apos;t refresh the {things}.</span> This list
              may be out of date. {errorMessage(error)}
            </p>
            <button type="button" onClick={reload} className={MENU_SECONDARY_BUTTON}>
              Try again
            </button>
          </div>
        )}
        {rows.length === 0 ? (
          <EmptyState title={`No ${things} yet`}>Use the form to add the first one.</EmptyState>
        ) : (
          // role="list" keeps the list semantics that Safari drops from unstyled lists.
          <ul
            role="list"
            aria-labelledby={headingId}
            className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 shadow-sm"
          >
            {rows.map((row) => (
              <MenuCatalogRow
                key={row.id}
                catalog={catalog}
                row={row}
                onSaved={handleSaved}
                onNameConflict={reload}
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div>
        <h2 id={headingId} className="text-xl font-semibold tracking-tight text-stone-900">
          {catalog.title}
        </h2>
        <p className="mt-1 text-sm text-stone-600">{catalog.description}</p>
        {/* Always rendered, so screen readers announce each new message. */}
        <div role="status">
          {message === '' ? null : (
            <p className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-900">
              {message}
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0">{list}</div>
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <h3 id={createHeadingId} className="mb-3 font-semibold text-stone-900">
            Add a {catalog.noun}
          </h3>
          <MenuCatalogForm
            labelledBy={createHeadingId}
            initialDraft={catalog.emptyDraft}
            parse={catalog.parse}
            Fields={catalog.Fields}
            submitLabel={`Add ${catalog.noun}`}
            savingLabel="Adding…"
            onSave={create}
            resetAfterSave
          />
        </div>
      </div>
    </section>
  );
}

/** The list with each saved row in place of its old copy. New rows go last until the reload sorts them. */
function withSaved<Row extends CatalogRow>(list: Row[], saved: Row[]): Row[] {
  if (saved.length === 0) {
    return list;
  }
  const savedById = new Map(saved.map((row) => [row.id, row]));
  const listed = new Set(list.map((row) => row.id));
  return [
    ...list.map((row) => savedById.get(row.id) ?? row),
    ...saved.filter((row) => !listed.has(row.id)),
  ];
}
