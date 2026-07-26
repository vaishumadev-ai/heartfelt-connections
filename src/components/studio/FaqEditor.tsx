import { useCallback, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

export type FaqPair = { q: string; a: string };

type Row = FaqPair & { id: string };

function makeId() {
  return `f_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
function toRows(values: FaqPair[]): Row[] {
  return values.map((v) => ({ id: makeId(), q: v.q, a: v.a }));
}

export type FaqEditorProps = {
  values: FaqPair[];
  onChange: (next: FaqPair[]) => void;
  disabled?: boolean;
  maxItems?: number;
  fieldId?: string;
};

/**
 * FAQ editor with stable row identity. Serialises to `{q,a}[]`, dropping
 * fully-empty rows on serialise but keeping them in local state so users
 * can compose without focus loss.
 */
export function FaqEditor({ values, onChange, disabled, maxItems = 25, fieldId }: FaqEditorProps) {
  const signature = useMemo(() => values.map((v) => `${v.q}\u0001${v.a}`).join("\u0002"), [values]);
  const [rows, setRows] = useState<Row[]>(() => toRows(values));
  const lastSigRef = useRef(signature);
  if (lastSigRef.current !== signature) {
    const currentSig = rows.map((r) => `${r.q}\u0001${r.a}`).join("\u0002");
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
      onChange(next.map(({ q, a }) => ({ q, a })));
    },
    [onChange],
  );

  const update = (id: string, patch: Partial<FaqPair>) =>
    emit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => emit(rows.filter((r) => r.id !== id));
  const add = () => {
    if (rows.length >= maxItems) return;
    emit([...rows, { id: makeId(), q: "", a: "" }]);
  };

  return (
    <fieldset className="rounded-2xl bg-background p-4" id={fieldId}>
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Frequently asked questions
      </legend>
      <ul className="mt-3 space-y-3">
        {rows.map((r, i) => {
          const qBad = r.q.trim() === "" && r.a.trim() !== "";
          const aBad = r.a.trim() === "" && r.q.trim() !== "";
          return (
            <li key={r.id} className="rounded-xl bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">Q{i + 1}</span>
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  disabled={disabled}
                  aria-label={`Remove FAQ ${i + 1}`}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <input
                aria-label={`FAQ ${i + 1} question`}
                aria-invalid={qBad || undefined}
                value={r.q}
                onChange={(e) => update(r.id, { q: e.target.value })}
                placeholder="Question"
                disabled={disabled}
                className={`mt-1 min-h-11 w-full rounded-lg bg-background px-3 py-2 text-sm outline-none ring-1 ${qBad ? "ring-red-400" : "ring-transparent focus:ring-foreground"}`}
              />
              <textarea
                aria-label={`FAQ ${i + 1} answer`}
                aria-invalid={aBad || undefined}
                value={r.a}
                onChange={(e) => update(r.id, { a: e.target.value })}
                placeholder="Answer"
                rows={3}
                disabled={disabled}
                className={`mt-2 w-full resize-none rounded-lg bg-background px-3 py-2 text-sm outline-none ring-1 ${aBad ? "ring-red-400" : "ring-transparent focus:ring-foreground"}`}
              />
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="rounded-xl bg-card p-3 text-xs text-muted-foreground">
            No FAQ entries yet.
          </li>
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
          <Plus className="h-3 w-3" /> Add FAQ
        </button>
      </div>
    </fieldset>
  );
}