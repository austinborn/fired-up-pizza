import { useEffect, useId, useRef, useState } from 'react';
import { errorMessage } from '../../api/http';
import { MENU_SECONDARY_BUTTON } from './menu-button-class';
import {
  changedValues,
  isNameConflict,
  type CatalogRow,
  type Draft,
  type MenuCatalog,
} from './menu-catalog';
import { MenuCatalogForm } from './MenuCatalogForm';

interface MenuCatalogRowProps<Row extends CatalogRow, Values extends object> {
  catalog: MenuCatalog<Row, Values>;
  row: Row;
  /** Gets the server's copy of a saved row, and what to tell staff about the save. */
  onSaved: (row: Row, message: string) => void;
  /** An edit failed with 409 CONFLICT: another row has the name, so the list should load again. */
  onNameConflict: () => void;
}

/** A failed hide or show, kept until the next try. */
interface ToggleFailure {
  action: 'hide' | 'show';
  error: unknown;
}

/**
 * One menu item or topping in the staff list: its name, a "Hidden" mark when
 * customers cannot see it, its details, and two actions.
 * - Edit opens an inline form, which sends only the fields that changed.
 * - Hide/Show flips `available` at once. While that save is in flight the
 *   button is disabled and says so; a failure is shown under the row.
 * Focus returns to the Edit button when the editor closes. It returns to the
 * toggle after a save unless staff moved it elsewhere meanwhile.
 */
export function MenuCatalogRow<Row extends CatalogRow, Values extends object>({
  catalog,
  row,
  onSaved,
  onNameConflict,
}: MenuCatalogRowProps<Row, Values>) {
  const headingId = useId();
  const [editDraft, setEditDraft] = useState<Draft<Values> | null>(null);
  const [isToggling, setIsToggling] = useState(false);
  const [toggleFailure, setToggleFailure] = useState<ToggleFailure | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<'edit' | 'toggle' | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) {
      return;
    }
    pendingFocus.current = null;
    if (target === 'edit') {
      editButton.current?.focus();
    } else if (document.activeElement === null || document.activeElement === document.body) {
      // The disabled toggle lost focus while it was saving.
      toggleButton.current?.focus();
    }
  });

  function closeEditor() {
    setEditDraft(null);
    pendingFocus.current = 'edit';
  }

  async function save(values: Values) {
    const before = editDraft === null ? null : catalog.parse(editDraft);
    const changes = before?.ok ? changedValues(before.values, values) : values;
    if (Object.keys(changes).length === 0) {
      closeEditor();
      return;
    }
    let saved: Row;
    try {
      saved = await catalog.update(row.id, changes);
    } catch (error) {
      if (isNameConflict(error)) {
        onNameConflict();
      }
      throw error;
    }
    closeEditor();
    onSaved(saved, `Saved ${saved.name}.`);
  }

  async function toggleAvailability() {
    const action = row.available ? 'hide' : 'show';
    setIsToggling(true);
    setToggleFailure(null);
    try {
      const saved = await catalog.setAvailable(row.id, action === 'show');
      onSaved(
        saved,
        action === 'hide'
          ? `${saved.name} is now hidden from customers.`
          : `${saved.name} is visible to customers again.`,
      );
    } catch (error) {
      setToggleFailure({ action, error });
    }
    setIsToggling(false);
    pendingFocus.current = 'toggle';
  }

  if (editDraft !== null) {
    return (
      <li aria-labelledby={headingId} className="bg-white px-4 py-4">
        <h3 id={headingId} className="mb-3 font-semibold text-stone-900">
          Edit {row.name}
        </h3>
        <MenuCatalogForm
          labelledBy={headingId}
          initialDraft={editDraft}
          parse={catalog.parse}
          Fields={catalog.Fields}
          submitLabel="Save changes"
          savingLabel="Saving…"
          onSave={save}
          onCancel={closeEditor}
          autoFocus
        />
      </li>
    );
  }

  const details = catalog.details?.(row) ?? '';
  return (
    <li
      aria-labelledby={headingId}
      className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between ${
        row.available ? 'bg-white' : 'bg-stone-50'
      }`}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            id={headingId}
            className={`font-semibold ${row.available ? 'text-stone-900' : 'text-stone-500'}`}
          >
            {row.name}
          </h3>
          {row.available ? null : (
            <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-semibold tracking-wide text-stone-700 uppercase">
              Hidden
            </span>
          )}
        </div>
        <p className="text-sm text-stone-600">{catalog.summary(row)}</p>
        {details === '' ? null : <p className="text-sm text-stone-500">{details}</p>}
        {toggleFailure === null ? null : (
          <p role="alert" className="text-sm text-red-700">
            Couldn&apos;t {toggleFailure.action} {row.name}. {errorMessage(toggleFailure.error)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          ref={editButton}
          type="button"
          onClick={() => {
            setToggleFailure(null);
            setEditDraft(catalog.draftOf(row));
          }}
          className={MENU_SECONDARY_BUTTON}
        >
          {/* The space stays outside the span: name computation trims a span's own text. */}
          Edit <span className="sr-only">{row.name}</span>
        </button>
        <button
          ref={toggleButton}
          type="button"
          disabled={isToggling}
          onClick={() => void toggleAvailability()}
          className={MENU_SECONDARY_BUTTON}
        >
          {toggleLabel(row.available, isToggling)} <span className="sr-only">{row.name}</span>
        </button>
      </div>
    </li>
  );
}

function toggleLabel(available: boolean, isToggling: boolean): string {
  if (isToggling) {
    return available ? 'Hiding…' : 'Showing…';
  }
  return available ? 'Hide' : 'Show';
}
