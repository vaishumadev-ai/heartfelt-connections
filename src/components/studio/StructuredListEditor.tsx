import { useCallback, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

type Row = { id: string; value: string };

function makeId() {
  return `r_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function toRows(values: string[]): Row[] {
  return values.map((v) => ({ id: makeId(), value: v }));
}

export type StructuredListEditorProps = {
  label: string;
  helper?: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  maxItems?: number;
  maxItemLength?: number;
  disabled?: boolean;
  addLabel?: string;
  fieldId?: string;
};

/**
 * Reusable list editor with stable row identity (never uses array index
 * as React key). Serialises to `string[]`, preserving order. Empty rows
 * are visibly marked invalid but retained in local state so the user
 * doesn't lose focus mid-edit; the parent serialises with trimming.
 */
export function StructuredListEditor({
  label,
  helper,
  values,
  onChange,
  placeholder,
  maxItems = 25,
  maxItemLength = 200,
  disabled,
  addLabel = "Add item",
  fieldId,
}: StructuredListEditorProps) {
  // Hydrate rows once from the canonical parent values. We track a signature
  // of `values` so that a parent-level reset (courseId change, load) rebuilds
  // rows without wiping typing while values match.
  const signature = useMemo(() => values.join("\u0001"), [values]);
  const [rows, setRows] = useState<Row[]>(() => toRows(values));
  const lastSigRef = useRef(signature);
  if (lastSigRef.current !== signature) {
    // Parent supplied a genuinely different list (load or discard). Rehydrate.
    const currentSig = rows.map((r) => r.value).join("\u0001");
    if (currentSig !== signature) {
      lastSigRef.current = signature;
      setRows(toRows(values));
    } else {
      lastSigRef.current = signature;
    }
  }

  const emit = useCallback(
    (next: Row[]) => {
      setRows(next);
      onChange(next.map((r) => r.value));
    },
    [onChange],
  );

  const update = (id: string, value: string) => {
    emit(rows.map((r) => (r.id === id ? { ...r, value } : r)));
  };
  const remove = (id: string) => emit(rows.filter((r) => r.id !== id));
  const add = () => {
    if (rows.length >= maxItems) return;
    emit([...rows, { id: makeId(), value: "" }]);
  };

  return (
    <fieldset
      className="rounded-2xl bg-background p-4"
      id={fieldId}
      aria-describedby={helper ? `${fieldId ?? label}-helper` : undefined}
    >
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </legend>
      {helper && (
        <p id={`${fieldId ?? label}-helper`} className="mt-1 text-xs text-muted-foreground">
          {helper}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {rows.map((r, i) => {
          const invalid = r.value.trim().length === 0;
          const tooLong = r.value.length > maxItemLength;
          return (
            <li key={r.id} className="flex items-start gap-2">
              <span
                aria-hidden
                className="mt-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card text-[10px] font-semibold text-muted-foreground"
              >
                {i + 1}
              </span>
              <div className="flex-1">
                <input
                  aria-label={`${label} item ${i + 1}`}
                  aria-invalid={invalid || tooLong || undefined}
                  value={r.value}
                  onChange={(e) => update(r.id, e.target.value)}
                  placeholder={placeholder}
                  disabled={disabled}
                  className={`min-h-11 w-full rounded-xl bg-card px-3 py-2 text-sm outline-none ring-1 ${
                    invalid || tooLong ? "ring-red-400" : "ring-transparent focus:ring-foreground"
                  }`}
                />
                {tooLong && (
                  <p className="mt-1 text-xs text-red-600">
                    Keep this under {maxItemLength} characters.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(r.id)}
                disabled={disabled}
                aria-label={`Remove ${label} item ${i + 1}`}
                className="mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="rounded-xl bg-card p-3 text-xs text-muted-foreground">No items yet.</li>
        )}
      </ul>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {rows.length}/{maxItems}
        </span>
        <button
          type="button"
          onClick={add}
          disabled={disabled || rows.length >= maxItems}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-card px-4 py-2 text-xs font-semibold text-foreground ring-1 ring-border disabled:opacity-40"
        >
          <Plus className="h-3 w-3" /> {addLabel}
        </button>
      </div>
    </fieldset>
  );
}
