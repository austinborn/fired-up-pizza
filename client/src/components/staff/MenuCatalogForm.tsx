import { useEffect, useId, useRef, useState, type ComponentType } from 'react';
import { errorMessage } from '../../api/http';
import { fieldIssues } from '../../api/staff-catalog';
import { MENU_PRIMARY_BUTTON, MENU_SECONDARY_BUTTON } from './menu-button-class';
import type { Draft, FieldErrors, MenuFieldsProps, ParsedDraft } from './menu-catalog';

interface MenuCatalogFormProps<Values extends object> {
  /** The id of the heading that names the form, e.g. "Add a menu item". */
  labelledBy: string;
  initialDraft: Draft<Values>;
  parse: (draft: Draft<Values>) => ParsedDraft<Values>;
  Fields: ComponentType<MenuFieldsProps<Values>>;
  submitLabel: string;
  /** The submit button's text while the save is in flight, e.g. "Adding…". */
  savingLabel: string;
  /**
   * Saves the values. If it rejects, the form shows why: each field problem
   * that the server reports (VALIDATION_ERROR or CONFLICT) next to its field,
   * and any other failure above the buttons.
   */
  onSave: (values: Values) => Promise<void>;
  /** Adds a Cancel button. */
  onCancel?: () => void;
  /** Starts over from initialDraft after each save, as the create form does. */
  resetAfterSave?: boolean;
  /** Focuses the first field when the form appears, as an inline editor does. */
  autoFocus?: boolean;
}

type FocusTarget = 'first-field' | 'first-problem';

/**
 * A staff menu form: create or edit one menu item or topping (ADR 0007 rule 5).
 * - Submitting checks the draft with the server's rules first and sends
 *   nothing while a field is wrong.
 * - While the save is in flight, every input and button is disabled, so
 *   nothing can be sent twice.
 * - After a failed submit, focus moves to the first field with a problem (or
 *   to the submit button), once its message is on screen, so screen readers
 *   read the message with the field.
 */
export function MenuCatalogForm<Values extends object>({
  labelledBy,
  initialDraft,
  parse,
  Fields,
  submitLabel,
  savingLabel,
  onSave,
  onCancel,
  resetAfterSave = false,
  autoFocus = false,
}: MenuCatalogFormProps<Values>) {
  const idPrefix = useId();
  const [draft, setDraft] = useState(initialDraft);
  const [errors, setErrors] = useState<FieldErrors<Values>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(autoFocus ? 'first-field' : null);

  // Moves focus after the render that a submit causes: inputs are enabled
  // again and the messages are in the DOM by then.
  useEffect(() => {
    const target = pendingFocus.current;
    const form = formRef.current;
    if (target === null || form === null) {
      return;
    }
    pendingFocus.current = null;
    const selector = target === 'first-field' ? 'input, textarea' : '[aria-invalid="true"]';
    (form.querySelector<HTMLElement>(selector) ?? submitRef.current)?.focus();
  });

  function change(field: keyof Values, text: string) {
    setDraft((previous) => ({ ...previous, [field]: text }));
    setErrors((previous) =>
      previous[field] === undefined ? previous : { ...previous, [field]: undefined },
    );
  }

  async function submit() {
    const parsed = parse(draft);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setFormError(null);
      pendingFocus.current = 'first-problem';
      return;
    }
    setErrors({});
    setFormError(null);
    setIsSaving(true);
    try {
      await onSave(parsed.values);
    } catch (error) {
      const problems = problemsByField(error, draft);
      setErrors(problems.errors);
      setFormError(problems.unmatched ? errorMessage(error) : null);
      setIsSaving(false);
      pendingFocus.current = 'first-problem';
      return;
    }
    setIsSaving(false);
    if (resetAfterSave) {
      setDraft(initialDraft);
      pendingFocus.current = 'first-field';
    }
  }

  return (
    <form
      ref={formRef}
      aria-labelledby={labelledBy}
      noValidate
      className="@container"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={isSaving} className="space-y-4">
        <Fields idPrefix={idPrefix} draft={draft} errors={errors} onChange={change} />
        {formError === null ? null : (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
          >
            {formError}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button ref={submitRef} type="submit" className={MENU_PRIMARY_BUTTON}>
            {isSaving ? savingLabel : submitLabel}
          </button>
          {onCancel === undefined ? null : (
            <button type="button" onClick={onCancel} className={MENU_SECONDARY_BUTTON}>
              Cancel
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

/**
 * Splits a failed save's field issues into messages for this form's fields.
 * `unmatched` is true when something is left to say above the buttons: the
 * failure has no field issues (a network error, a 404), or it has one for a
 * field the form does not show.
 */
function problemsByField<Values>(
  error: unknown,
  draft: Draft<Values>,
): { errors: FieldErrors<Values>; unmatched: boolean } {
  const errors: FieldErrors<Values> = {};
  const issues = fieldIssues(error);
  let unmatched = issues.length === 0;
  for (const { path, message } of issues) {
    if (isField(draft, path)) {
      errors[path] ??= message;
    } else {
      unmatched = true;
    }
  }
  return { errors, unmatched };
}

function isField<Values>(
  draft: Draft<Values>,
  path: string,
): path is Extract<keyof Values, string> {
  return Object.hasOwn(draft, path);
}
