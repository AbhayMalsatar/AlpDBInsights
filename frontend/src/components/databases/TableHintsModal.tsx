import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  X, Loader2, Search, Plus, Trash2, BookMarked, CheckCircle2, AlertCircle,
  ChevronRight, Info,
} from 'lucide-react';
import type { DatabaseConnection } from '../../store/useAppStore';

type TableOverview = {
  table_name: string;
  column_count: number;
  columns: string[];
  row_count?: number | null;
};

type SegmentApi = {
  label: string;
  column?: string;
  values?: string[];
  where_sql?: string | null;
};

type HintEntryApi = {
  description?: string;
  segments?: SegmentApi[];
  approx_row_count?: number | null;
};

type HintsDoc = {
  version?: number;
  tables?: Record<string, HintEntryApi>;
};

type SegmentForm = {
  id: string;
  label: string;
  column: string;
  valuesStr: string;
  whereSql: string;
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseValues(s: string): string[] {
  return s
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function TableHintsModal({
  db,
  onClose,
}: {
  db: DatabaseConnection;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [overview, setOverview] = useState<TableOverview[]>([]);
  const [hintsDoc, setHintsDoc] = useState<HintsDoc>({ tables: {} });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const [description, setDescription] = useState('');
  const [approxRow, setApproxRow] = useState('');
  const [segments, setSegments] = useState<SegmentForm[]>([]);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await axios.get<{ hints: HintsDoc; tables_overview: TableOverview[] }>(
        `/api/database/${db.id}/table-hints`,
      );
      const ov = res.data.tables_overview || [];
      setOverview(ov);
      setHintsDoc(res.data.hints || { tables: {} });
      setSelected((prev) => {
        if (prev && ov.some((x) => x.table_name === prev)) return prev;
        return ov[0]?.table_name ?? null;
      });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to load hints.';
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per db id
  }, [db.id]);

  useEffect(() => {
    if (loading) return;
    if (!selected) {
      setDescription('');
      setApproxRow('');
      setSegments([]);
      return;
    }
    const h = hintsDoc.tables?.[selected];
    setDescription(h?.description ?? '');
    setApproxRow(h?.approx_row_count != null ? String(h.approx_row_count) : '');
    const segs = h?.segments ?? [];
    setSegments(
      segs.length
        ? segs.map((s) => ({
            id: uid(),
            label: s.label ?? '',
            column: s.column ?? '',
            valuesStr: (s.values ?? []).join(', '),
            whereSql: s.where_sql ?? '',
          }))
        : [{ id: uid(), label: '', column: '', valuesStr: '', whereSql: '' }],
    );
  }, [loading, selected, hintsDoc]);

  const filteredOverview = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return overview;
    return overview.filter((t) => t.table_name.toLowerCase().includes(q));
  }, [overview, search]);

  const selectedMeta = useMemo(
    () => overview.find((t) => t.table_name === selected),
    [overview, selected],
  );

  const buildPayloadForCurrentTable = (): Record<string, HintEntryApi> | null => {
    if (!selected) return null;
    const segsOut: SegmentApi[] = [];
    for (const s of segments) {
      if (!s.label.trim()) continue;
      const ws = s.whereSql.trim();
      const col = s.column.trim();
      const vals = parseValues(s.valuesStr);
      // Always persist column + values + optional where_sql (do not drop column/values when custom SQL is set).
      const seg: SegmentApi = {
        label: s.label.trim(),
        column: col,
        values: vals,
      };
      if (ws) seg.where_sql = ws;
      segsOut.push(seg);
    }
    const approx = approxRow.trim() === '' ? null : Number(approxRow);
    return {
      [selected]: {
        description: description.trim(),
        segments: segsOut,
        approx_row_count: Number.isFinite(approx as number) ? (approx as number) : null,
      },
    };
  };

  const handleSaveTable = async () => {
    if (!selected) return;
    setSaving(true);
    setErr(null);
    setOkMsg(null);
    try {
      const tables = buildPayloadForCurrentTable();
      if (!tables) return;
      const res = await axios.put<{ ok: boolean; hints_fingerprint: string; reindexed_tables: string[] }>(
        `/api/database/${db.id}/table-hints`,
        { tables },
      );
      setOkMsg(`Saved. Search index updated for: ${(res.data.reindexed_tables || []).join(', ') || selected}.`);
      await load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Save failed.';
      setErr(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleClearTable = async () => {
    if (!selected) return;
    setSaving(true);
    setErr(null);
    setOkMsg(null);
    try {
      await axios.put(`/api/database/${db.id}/table-hints`, {
        tables: {
          [selected]: { description: '', segments: [], approx_row_count: null },
        },
      });
      setDescription('');
      setApproxRow('');
      setSegments([{ id: uid(), label: '', column: '', valuesStr: '', whereSql: '' }]);
      setOkMsg('Hints removed for this table.');
      await load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Clear failed.';
      setErr(msg);
    } finally {
      setSaving(false);
    }
  };

  const addSegment = () => {
    setSegments((s) => [...s, { id: uid(), label: '', column: '', valuesStr: '', whereSql: '' }]);
  };

  const removeSegment = (id: string) => {
    setSegments((s) => (s.length <= 1 ? s : s.filter((x) => x.id !== id)));
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      onClick={onClose}
    >
      <div
        className="card anim-scale-in flex flex-col overflow-hidden w-full"
        style={{ maxWidth: 920, maxHeight: '92vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-start justify-between gap-4 px-5 py-4"
          style={{ borderBottom: '1px solid hsl(var(--border))' }}
        >
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: 'hsl(var(--fg))' }}>
              <BookMarked size={18} style={{ color: 'hsl(var(--primary))' }} />
              AI table rules — {db.name}
            </h2>
            <p className="text-xs mt-1 max-w-xl" style={{ color: 'hsl(var(--fg-muted))' }}>
              When one physical table stores several business flows (e.g. sales vs returns), describe them here. The
              AI uses this for search, table picking, and SQL — without sending your full schema every time.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg transition-colors flex-shrink-0"
            style={{ color: 'hsl(var(--fg-muted))' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2" style={{ color: 'hsl(var(--fg-muted))' }}>
            <Loader2 size={22} className="anim-spin" />
            <span className="text-xs">Loading tables and saved rules…</span>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* Table list */}
            <div
              className="flex flex-col border-r flex-shrink-0"
              style={{ width: 280, borderColor: 'hsl(var(--border))' }}
            >
              <div className="p-2" style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                <div
                  className="flex items-center gap-2 px-2 h-8 rounded-lg"
                  style={{ background: 'hsl(var(--surface-raised))', border: '1px solid hsl(var(--border))' }}
                >
                  <Search size={12} style={{ color: 'hsl(var(--fg-subtle))' }} />
                  <input
                    className="bg-transparent outline-none text-xs flex-1 min-w-0"
                    style={{ color: 'hsl(var(--fg))' }}
                    placeholder="Search tables…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="overflow-y-auto flex-1 p-2 space-y-0.5">
                {filteredOverview.length === 0 ? (
                  <p className="text-xs px-2 py-4" style={{ color: 'hsl(var(--fg-muted))' }}>
                    No tables in snapshot. Reconnect this database to refresh.
                  </p>
                ) : (
                  filteredOverview.map((t) => {
                    const has = Boolean(
                      hintsDoc.tables?.[t.table_name]?.description?.trim() ||
                        ((hintsDoc.tables?.[t.table_name]?.segments?.length ?? 0) > 0),
                    );
                    const active = t.table_name === selected;
                    return (
                      <button
                        key={t.table_name}
                        type="button"
                        onClick={() => setSelected(t.table_name)}
                        className="w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2 transition-colors"
                        style={{
                          background: active ? 'hsl(var(--primary-muted))' : 'transparent',
                          border: active ? '1px solid hsl(var(--primary) / 0.35)' : '1px solid transparent',
                        }}
                      >
                        <ChevronRight size={12} className="flex-shrink-0 opacity-40" />
                        <span className="text-xs font-medium truncate flex-1" style={{ color: 'hsl(var(--fg))' }}>
                          {t.table_name}
                        </span>
                        <span className="text-[10px] flex-shrink-0" style={{ color: 'hsl(var(--fg-subtle))' }}>
                          {t.column_count} cols
                        </span>
                        {has && (
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ background: 'hsl(var(--primary))' }}
                            title="Has saved rules"
                          />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Editor */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {selectedMeta && (
                  <div
                    className="flex flex-wrap items-center gap-2 text-[11px] px-3 py-2 rounded-lg"
                    style={{ background: 'hsl(var(--surface-raised))', color: 'hsl(var(--fg-muted))' }}
                  >
                    <Info size={12} />
                    <span>
                      <strong style={{ color: 'hsl(var(--fg))' }}>{selectedMeta.column_count}</strong> columns
                      {selectedMeta.row_count != null && (
                        <>
                          {' '}
                          · snapshot row count:{' '}
                          <strong style={{ color: 'hsl(var(--fg))' }}>{Number(selectedMeta.row_count).toLocaleString()}</strong>
                        </>
                      )}
                    </span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'hsl(var(--fg-muted))' }}>
                    What does this table contain?
                  </label>
                  <textarea
                    className="input w-full text-xs min-h-[72px] resize-y"
                    style={{ fontFamily: 'inherit' }}
                    placeholder="e.g. All sales documents: bills, returns, and approvals. Always filter by IrType."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'hsl(var(--fg-muted))' }}>
                    Approx. row count (optional)
                  </label>
                  <input
                    className="input w-full text-xs max-w-[200px]"
                    type="number"
                    min={0}
                    placeholder="e.g. 500000"
                    value={approxRow}
                    onChange={(e) => setApproxRow(e.target.value)}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium" style={{ color: 'hsl(var(--fg-muted))' }}>
                      Row types / modules (discriminator rules)
                    </label>
                    <button
                      type="button"
                      onClick={addSegment}
                      className="text-[11px] font-medium flex items-center gap-1 px-2 py-1 rounded-md"
                      style={{ color: 'hsl(var(--primary))', background: 'hsl(var(--primary-muted))' }}
                    >
                      <Plus size={12} /> Add rule
                    </button>
                  </div>
                  <p className="text-[10px] mb-3" style={{ color: 'hsl(var(--fg-subtle))' }}>
                    Example: Label &quot;Sales return&quot;, column <code>IrType</code>, values <code>SR, RET</code>. Or use
                    custom SQL predicate instead.
                  </p>
                  <div className="space-y-3">
                    {segments.map((seg, idx) => (
                      <div
                        key={seg.id}
                        className="rounded-xl p-3 space-y-2"
                        style={{ border: '1px solid hsl(var(--border))', background: 'hsl(var(--surface))' }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--fg-subtle))' }}>
                            Rule {idx + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeSegment(seg.id)}
                            className="p-1 rounded-md transition-colors"
                            style={{ color: 'hsl(var(--danger))' }}
                            title="Remove rule"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <input
                          className="input w-full text-xs"
                          placeholder="Label shown to AI (e.g. Sales bill)"
                          value={seg.label}
                          onChange={(e) =>
                            setSegments((ss) => ss.map((x) => (x.id === seg.id ? { ...x, label: e.target.value } : x)))
                          }
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            className="input text-xs"
                            placeholder="Column (e.g. IrType)"
                            value={seg.column}
                            onChange={(e) =>
                              setSegments((ss) => ss.map((x) => (x.id === seg.id ? { ...x, column: e.target.value } : x)))
                            }
                          />
                          <input
                            className="input text-xs"
                            placeholder="Values: SR, S, SB"
                            value={seg.valuesStr}
                            onChange={(e) =>
                              setSegments((ss) => ss.map((x) => (x.id === seg.id ? { ...x, valuesStr: e.target.value } : x)))
                            }
                          />
                        </div>
                        <input
                          className="input w-full text-xs font-mono"
                          placeholder="Optional: custom WHERE fragment (overrides column+values)"
                          value={seg.whereSql}
                          onChange={(e) =>
                            setSegments((ss) => ss.map((x) => (x.id === seg.id ? { ...x, whereSql: e.target.value } : x)))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {selectedMeta && selectedMeta.columns.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-medium" style={{ color: 'hsl(var(--fg-muted))' }}>
                      Column names (reference)
                    </summary>
                    <div
                      className="mt-2 p-2 rounded-lg max-h-32 overflow-y-auto font-mono text-[10px] leading-relaxed"
                      style={{ background: 'hsl(var(--surface-raised))', color: 'hsl(var(--fg-subtle))' }}
                    >
                      {selectedMeta.columns.join(', ')}
                    </div>
                  </details>
                )}
              </div>

              {err && (
                <div
                  className="mx-5 mb-2 flex items-center gap-2 text-xs p-2.5 rounded-lg"
                  style={{ background: 'hsl(var(--danger-bg))', color: 'hsl(var(--danger))' }}
                >
                  <AlertCircle size={14} /> {err}
                </div>
              )}
              {okMsg && (
                <div
                  className="mx-5 mb-2 flex items-center gap-2 text-xs p-2.5 rounded-lg"
                  style={{ background: 'hsl(var(--success-bg))', color: 'hsl(var(--success))' }}
                >
                  <CheckCircle2 size={14} /> {okMsg}
                </div>
              )}

              <div
                className="flex items-center justify-end gap-2 px-5 py-3 flex-wrap"
                style={{ borderTop: '1px solid hsl(var(--border))' }}
              >
                <button
                  type="button"
                  onClick={handleClearTable}
                  disabled={saving || !selected}
                  className="h-9 px-3 rounded-lg text-xs font-medium mr-auto"
                  style={{
                    border: '1px solid hsl(var(--border))',
                    color: 'hsl(var(--danger))',
                    opacity: saving ? 0.5 : 1,
                  }}
                >
                  Clear this table
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="h-9 px-4 rounded-lg text-xs font-medium"
                  style={{ background: 'hsl(var(--surface-raised))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--fg-muted))' }}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleSaveTable}
                  disabled={saving || !selected}
                  className="h-9 px-4 rounded-lg text-xs font-semibold btn-primary flex items-center gap-2"
                >
                  {saving ? <Loader2 size={14} className="anim-spin" /> : null}
                  Save rules for this table
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
