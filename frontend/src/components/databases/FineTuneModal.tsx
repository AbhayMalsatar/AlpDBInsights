import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Brain, CheckCircle2, Loader2, Sparkles, X } from 'lucide-react';
import { databaseApi, type FineTuneStatus } from '../../api/database';
import type { DatabaseConnection } from '../../store/useAppStore';

const RUNNING = new Set(['validating_files', 'queued', 'running']);

function statusTone(status: string) {
  if (status === 'succeeded') {
    return {
      bg: 'hsl(var(--success-bg))',
      color: 'hsl(var(--success))',
      border: 'hsl(var(--success) / 0.2)',
      icon: CheckCircle2,
    };
  }
  if (status === 'failed' || status === 'cancelled') {
    return {
      bg: 'hsl(var(--danger-bg))',
      color: 'hsl(var(--danger))',
      border: 'hsl(var(--danger) / 0.2)',
      icon: AlertCircle,
    };
  }
  return {
    bg: 'hsl(var(--primary-light))',
    color: 'hsl(var(--primary))',
    border: 'hsl(var(--primary) / 0.2)',
    icon: Loader2,
  };
}

export function FineTuneModal({
  db,
  onClose,
}: {
  db: DatabaseConnection;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<FineTuneStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadStatus = async () => {
    setErr(null);
    try {
      const next = await databaseApi.getFineTuneStatus(db.id);
      setStatus(next);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to load fine-tune status.';
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.id]);

  useEffect(() => {
    if (!status || !RUNNING.has(status.status)) return;
    const id = window.setInterval(() => {
      void loadStatus();
    }, 8000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.status, db.id]);

  const handleStart = async () => {
    setStarting(true);
    setErr(null);
    try {
      const next = await databaseApi.startFineTune(db.id);
      setStatus(next);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to start fine-tuning.';
      setErr(msg);
    } finally {
      setStarting(false);
    }
  };

  const tone = statusTone(status?.status ?? 'idle');
  const ToneIcon = tone.icon;
  const tableCount = db.tables?.length ?? db.tablesCount ?? 0;
  const hintedCount = useMemo(() => status?.dataset_tables?.length ?? 0, [status?.dataset_tables]);
  const running = Boolean(status && RUNNING.has(status.status));

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      onClick={onClose}
    >
      <div
        className="card anim-scale-in w-full flex flex-col overflow-hidden"
        style={{ maxWidth: 640 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4" style={{ borderBottom: '1px solid hsl(var(--border))' }}>
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: 'hsl(var(--fg))' }}>
              <Brain size={18} style={{ color: 'hsl(var(--primary))' }} />
              Fine-tune AI model - {db.name}
            </h2>
            <p className="text-xs mt-1 max-w-xl" style={{ color: 'hsl(var(--fg-muted))' }}>
              Train an OpenAI model with this database snapshot and saved table hints. Future hint saves will auto-train only
              the touched tables.
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

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Snapshot tables', value: tableCount },
              { label: 'Current dataset tables', value: hintedCount || tableCount },
              { label: 'Training examples', value: status?.training_examples ?? 0 },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl p-3"
                style={{ background: 'hsl(var(--surface-raised))', border: '1px solid hsl(var(--border))' }}
              >
                <div className="text-[10px] uppercase tracking-wide" style={{ color: 'hsl(var(--fg-subtle))' }}>
                  {item.label}
                </div>
                <div className="text-lg font-semibold mt-1" style={{ color: 'hsl(var(--fg))' }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'hsl(var(--fg-muted))' }}>
              <Loader2 size={14} className="anim-spin" />
              Loading fine-tune status...
            </div>
          ) : (
            <div
              className="rounded-xl p-3 flex items-start gap-3"
              style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
            >
              <ToneIcon
                size={15}
                className={running ? 'anim-spin' : undefined}
                style={{ color: tone.color, marginTop: 1 }}
              />
              <div className="min-w-0">
                <div className="text-xs font-semibold" style={{ color: tone.color }}>
                  Status: {status?.status ?? 'idle'}
                </div>
                <div className="text-xs mt-1" style={{ color: 'hsl(var(--fg-muted))' }}>
                  {status?.message
                    ?? (status?.fine_tuned_model
                      ? `Active fine-tuned model: ${status.fine_tuned_model}`
                      : status?.enabled
                      ? 'No fine-tuned model active yet.'
                      : 'Enable OpenAI and add an API key to use this feature.')}
                </div>
                {status?.job_id && (
                  <div className="text-[11px] mt-2 font-mono" style={{ color: 'hsl(var(--fg-subtle))' }}>
                    Job: {status.job_id}
                  </div>
                )}
                {status?.last_error && (
                  <div className="text-[11px] mt-2" style={{ color: 'hsl(var(--danger))' }}>
                    {status.last_error}
                  </div>
                )}
              </div>
            </div>
          )}

          <div
            className="rounded-xl p-4 space-y-2"
            style={{ background: 'hsl(var(--surface-raised))', border: '1px solid hsl(var(--border))' }}
          >
            <div className="text-xs font-semibold" style={{ color: 'hsl(var(--fg))' }}>
              What gets trained
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'hsl(var(--fg-muted))' }}>
              The backend builds JSONL training examples from the saved schema snapshot, table descriptions, discriminator
              rules, row-count hints, and segment filters for this database.
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'hsl(var(--fg-muted))' }}>
              After the job succeeds, AI requests for this database automatically switch to the fine-tuned model.
            </div>
          </div>

          {err && (
            <div className="flex items-center gap-2 text-xs p-2.5 rounded-lg" style={{ background: 'hsl(var(--danger-bg))', color: 'hsl(var(--danger))' }}>
              <AlertCircle size={14} /> {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid hsl(var(--border))' }}>
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-lg text-xs font-medium"
            style={{ background: 'hsl(var(--surface-raised))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--fg-muted))' }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={starting || running || !status?.enabled}
            className="h-9 px-4 rounded-lg text-xs font-semibold btn-primary flex items-center gap-2"
          >
            {starting ? <Loader2 size={14} className="anim-spin" /> : <Sparkles size={14} />}
            {running ? 'Job Running…' : 'Start Fine-tune'}
          </button>
        </div>
      </div>
    </div>
  );
}
