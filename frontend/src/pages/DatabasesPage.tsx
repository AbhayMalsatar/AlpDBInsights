import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Database, Plus, Trash2, RefreshCw, CheckCircle2, XCircle,
  Loader2, Table2, Server, ShieldCheck, ChevronDown, ChevronRight,
  Key, Link2, Search, Eye, Code2, Rows3, Hash, LayoutList,
  Sparkles, BarChart2, CheckCheck, AlertCircle, BookMarked, List, ClipboardPaste,
} from 'lucide-react';
import { TableHintsModal } from '../components/databases/TableHintsModal';
import axios from 'axios';
import { useAppStore } from '../store/useAppStore';
import type {
  DatabaseConnection, TableInfo, ViewInfo, ProcedureInfo,
  ChartData, ChartType,
} from '../store/useAppStore';

type DBType = 'postgresql' | 'mssql';

const DB_TYPES: { value: DBType; label: string; port: number; icon: string; color: string }[] = [
  { value: 'postgresql', label: 'PostgreSQL', port: 5432, icon: '🐘', color: '#336791' },
  { value: 'mssql',      label: 'SQL Server', port: 1433, icon: '🗄️', color: '#CC2927' },
];

/* ══════════════════════════════════════════════════════════════
   CONNECT MODAL
══════════════════════════════════════════════════════════════ */
type ConnectMode = 'form' | 'string';

function ConnectModal({
  onClose, onConnected,
}: { onClose: () => void; onConnected: (db: DatabaseConnection) => void }) {
  const [connectMode, setConnectMode] = useState<ConnectMode>('form');
  const [form, setForm] = useState({
    type: 'postgresql' as DBType,
    name: '', host: 'localhost', port: '5432',
    database: '', username: '', password: '',
  });
  const [connStr, setConnStr] = useState('');
  const [connDisplayName, setConnDisplayName] = useState('');
  const [status, setStatus] = useState<'idle' | 'testing' | 'connecting' | 'ok' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleTypeChange = (t: DBType) => {
    const info = DB_TYPES.find(d => d.value === t)!;
    setForm(f => ({ ...f, type: t, port: String(info.port) }));
  };

  const handleTest = async () => {
    setStatus('testing'); setMsg('');
    try {
      await axios.post('/api/database/test', {
        type: form.type, host: form.host, port: Number(form.port),
        database: form.database, username: form.username, password: form.password,
      });
      setStatus('ok'); setMsg('Connection successful!');
    } catch {
      setStatus('error'); setMsg('Connection failed. Check your credentials.');
    }
  };

  const mapResponseToConnection = (d: Record<string, unknown>, meta: {
    name: string;
    type: DBType;
    host: string;
    port: number;
    database: string;
    username: string;
  }): DatabaseConnection => ({
    id:               String(d.db_id ?? d.id ?? ''),
    name:             meta.name,
    type:             meta.type,
    host:             meta.host,
    port:             meta.port,
    database:         meta.database,
    username:         meta.username,
    status:           'connected',
    connectedAt:      new Date().toISOString(),
    tablesCount:      (d.tables_count as number)    ?? (Array.isArray(d.tables) ? d.tables.length : 0),
    viewsCount:       (d.views_count as number)     ?? (Array.isArray(d.views) ? d.views.length : 0),
    proceduresCount: (d.procedures_count as number) ?? (Array.isArray(d.procedures) ? d.procedures.length : 0),
    tables:           (d.tables as TableInfo[])     ?? [],
    views:            (d.views as ViewInfo[])       ?? [],
    procedures:       (d.procedures as ProcedureInfo[]) ?? [],
  });

  const handleConnect = async () => {
    setStatus('connecting');
    try {
      const res = await axios.post('/api/database/connect', {
        type: form.type, host: form.host, port: Number(form.port),
        database: form.database, username: form.username, password: form.password,
        name: form.name || form.database,
      });
      const d = res.data as Record<string, unknown>;
      onConnected(mapResponseToConnection(d, {
        name: form.name || form.database,
        type: form.type,
        host: form.host,
        port: Number(form.port),
        database: form.database,
        username: form.username,
      }));
      onClose();
    } catch (e: unknown) {
      setStatus('error');
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to connect.';
      setMsg(msg);
    }
  };

  const handleConnectString = async () => {
    const trimmed = connStr.trim();
    if (!trimmed) {
      setStatus('error');
      setMsg('Paste a connection string first.');
      return;
    }
    setStatus('connecting');
    setMsg('');
    try {
      const res = await axios.post('/api/database/connect-string', {
        connection_string: trimmed,
        name: connDisplayName.trim(),
      });
      const d = res.data as Record<string, unknown>;
      const dbType = (d.type as DBType) || 'postgresql';
      const display = (connDisplayName.trim() || (d.name as string) || (d.database as string) || 'Database') as string;
      onConnected(mapResponseToConnection(d, {
        name: display,
        type: dbType,
        host: String(d.host ?? ''),
        port: Number(d.port ?? (dbType === 'mssql' ? 1433 : 5432)),
        database: String(d.database ?? ''),
        username: String(d.username ?? ''),
      }));
      onClose();
    } catch (e: unknown) {
      setStatus('error');
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to connect.';
      setMsg(msg);
    }
  };

  const fields: { k: keyof typeof form; label: string; placeholder: string; type?: string; span2?: boolean }[] = [
    { k: 'name',     label: 'Display Name', placeholder: 'My Database',  span2: true },
    { k: 'host',     label: 'Host',         placeholder: 'localhost',    span2: true },
    { k: 'port',     label: 'Port',         placeholder: '5432' },
    { k: 'database', label: 'Database',     placeholder: 'northwind' },
    { k: 'username', label: 'Username',     placeholder: 'postgres' },
    { k: 'password', label: 'Password',     placeholder: '••••••••', type: 'password' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose}>
      <div
        className="card anim-scale-in w-full"
        style={{ maxWidth: connectMode === 'string' ? 520 : 460, padding: 28, maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold mb-1" style={{ color: 'hsl(var(--fg))' }}>Connect database</h2>
        <p className="text-xs mb-4" style={{ color: 'hsl(var(--fg-muted))' }}>Use the form or paste a connection string to index schema for AI.</p>

        <div className="flex rounded-lg p-0.5 mb-5" style={{ background: 'hsl(var(--surface-raised))', border: '1px solid hsl(var(--border))' }}>
          <button
            type="button"
            onClick={() => { setConnectMode('form'); setMsg(''); setStatus('idle'); }}
            className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-xs font-medium transition-colors"
            style={{
              background: connectMode === 'form' ? 'hsl(var(--surface))' : 'transparent',
              color: connectMode === 'form' ? 'hsl(var(--fg))' : 'hsl(var(--fg-muted))',
              boxShadow: connectMode === 'form' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <List size={13} aria-hidden /> Form
          </button>
          <button
            type="button"
            onClick={() => { setConnectMode('string'); setMsg(''); setStatus('idle'); }}
            className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-xs font-medium transition-colors"
            style={{
              background: connectMode === 'string' ? 'hsl(var(--surface))' : 'transparent',
              color: connectMode === 'string' ? 'hsl(var(--fg))' : 'hsl(var(--fg-muted))',
              boxShadow: connectMode === 'string' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <ClipboardPaste size={13} aria-hidden /> Connection string
          </button>
        </div>

        {connectMode === 'form' ? (
          <>
            <div className="grid grid-cols-2 gap-2 mb-5">
              {DB_TYPES.map(t => (
                <button key={t.value} type="button" onClick={() => handleTypeChange(t.value)}
                  className="p-3 rounded-xl border text-left transition-all"
                  style={{
                    background:   form.type === t.value ? 'hsl(var(--primary-muted))' : 'hsl(var(--surface-raised))',
                    borderColor:  form.type === t.value ? 'hsl(var(--primary) / 0.5)' : 'hsl(var(--border))',
                    boxShadow:    form.type === t.value ? '0 0 0 2px hsl(var(--primary) / 0.1)' : 'none',
                  }}>
                  <div className="text-lg mb-1">{t.icon}</div>
                  <div className="text-xs font-semibold" style={{ color: 'hsl(var(--fg))' }}>{t.label}</div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              {fields.map(({ k, label, placeholder, type, span2 }) => (
                <div key={k} className={span2 ? 'col-span-2' : ''}>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'hsl(var(--fg-muted))' }}>{label}</label>
                  <input className="input" type={type || 'text'} placeholder={placeholder}
                    value={form[k]} onChange={e => set(k, e.target.value)} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="mb-4 space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'hsl(var(--fg-muted))' }}>Display name (optional)</label>
              <input
                className="input w-full text-sm"
                placeholder="e.g. Production warehouse"
                value={connDisplayName}
                onChange={e => setConnDisplayName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'hsl(var(--fg-muted))' }}>Connection string</label>
              <textarea
                className="input w-full text-xs font-mono min-h-[120px] resize-y leading-relaxed"
                spellCheck={false}
                placeholder={`PostgreSQL:\npostgresql://user:password@localhost:5432/mydb\n\nor JDBC:\njdbc:postgresql://localhost:5432/mydb\n\nSQL Server:\nServer=localhost,1433;Database=mydb;User Id=sa;Password=YourPassword;`}
                value={connStr}
                onChange={e => setConnStr(e.target.value)}
              />
            </div>
            <p className="text-[10px] leading-relaxed" style={{ color: 'hsl(var(--fg-subtle))' }}>
              PostgreSQL URIs and <code className="text-[10px]">jdbc:postgresql://</code> are detected automatically. For SQL Server, use
              semicolon-separated <code className="text-[10px]">Server=</code>, <code className="text-[10px]">Database=</code>,{' '}
              <code className="text-[10px]">User Id=</code>, <code className="text-[10px]">Password=</code>.
            </p>
          </div>
        )}

        {msg && (
          <div className="flex items-center gap-2 text-xs p-3 rounded-lg mb-4"
            style={{
              background: status === 'ok' ? 'hsl(var(--success-bg))' : 'hsl(var(--danger-bg))',
              color:      status === 'ok' ? 'hsl(var(--success))' : 'hsl(var(--danger))',
            }}>
            {status === 'ok' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            {msg}
          </div>
        )}

        <div className="flex gap-2">
          {connectMode === 'form' ? (
            <>
              <button type="button" onClick={handleTest} disabled={status === 'testing' || status === 'connecting'}
                className="flex-1 h-9 rounded-lg text-xs font-medium flex items-center justify-center gap-2"
                style={{ background: 'hsl(var(--surface-raised))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--fg-muted))' }}>
                {status === 'testing' ? <><Loader2 size={13} className="anim-spin" /> Testing…</> : <><RefreshCw size={13} /> Test</>}
              </button>
              <button type="button" onClick={handleConnect} disabled={status === 'connecting'}
                className="flex-1 h-9 rounded-lg text-xs font-semibold btn-primary flex items-center justify-center gap-2">
                {status === 'connecting' ? <><Loader2 size={13} className="anim-spin" /> Connecting…</> : 'Connect & index'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleConnectString}
              disabled={status === 'connecting'}
              className="w-full h-10 rounded-lg text-sm font-semibold btn-primary flex items-center justify-center gap-2"
            >
              {status === 'connecting' ? <><Loader2 size={14} className="anim-spin" /> Connecting…</> : <><Link2 size={14} /> Connect & index</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TABLE CARD
══════════════════════════════════════════════════════════════ */
function TableCard({ table }: { table: TableInfo }) {
  const [open, setOpen] = useState(false);
  const pkCount  = table.columns.filter(c => c.primary_key).length;
  const fkCount  = table.columns.filter(c => c.foreign_key).length;

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid hsl(var(--border))', background: 'hsl(var(--surface))' }}>
      {/* Header */}
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 text-left transition-colors"
        style={{ background: open ? 'hsl(var(--primary-muted))' : 'transparent' }}
        onMouseEnter={e => { if (!open) (e.currentTarget as HTMLElement).style.background = 'hsl(var(--surface-raised))'; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>

        <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
          style={{ background: 'hsl(var(--primary) / 0.12)' }}>
          <Table2 size={11} style={{ color: 'hsl(var(--primary))' }} />
        </div>

        <span className="text-xs font-semibold flex-1 truncate" style={{ color: 'hsl(var(--fg))' }}>
          {table.table_name}
        </span>

        {/* pills */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full"
            style={{ background: 'hsl(var(--surface-raised))', color: 'hsl(var(--fg-muted))' }}>
            <Rows3 size={9} /> {table.columns.length} cols
          </span>
          {table.row_count != null && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: 'hsl(var(--success-bg))', color: 'hsl(var(--success))' }}>
              <Hash size={9} /> {table.row_count.toLocaleString()}
            </span>
          )}
          {pkCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: 'hsl(var(--warning-bg))', color: 'hsl(var(--warning))' }}>
              <Key size={9} /> {pkCount} PK
            </span>
          )}
          {fkCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: 'hsl(var(--primary-light))', color: 'hsl(var(--primary))' }}>
              <Link2 size={9} /> {fkCount} FK
            </span>
          )}
        </div>

        {open ? <ChevronDown size={13} style={{ color: 'hsl(var(--fg-muted))' }} />
               : <ChevronRight size={13} style={{ color: 'hsl(var(--fg-muted))' }} />}
      </button>

      {/* Columns list */}
      {open && (
        <div className="anim-fade-up" style={{ borderTop: '1px solid hsl(var(--border))' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'hsl(var(--surface-raised))' }}>
                {['Column', 'Type', 'Flags'].map(h => (
                  <th key={h} style={{ padding: '5px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'hsl(var(--fg-subtle))', letterSpacing: '0.05em' }}>
                    {h.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.columns.map((col, i) => (
                <tr key={col.name}
                  style={{ background: i % 2 === 0 ? 'transparent' : 'hsl(var(--surface-raised))', borderTop: '1px solid hsl(var(--border))' }}>
                  <td style={{ padding: '5px 12px', fontSize: 12, color: 'hsl(var(--fg))', fontWeight: col.primary_key ? 600 : 400 }}>
                    {col.primary_key && <Key size={9} style={{ display: 'inline', marginRight: 4, color: 'hsl(var(--warning))' }} />}
                    {col.name}
                  </td>
                  <td style={{ padding: '5px 12px', fontSize: 11, color: 'hsl(var(--fg-muted))', fontFamily: 'monospace' }}>
                    {col.data_type}
                  </td>
                  <td style={{ padding: '5px 12px' }}>
                    <div className="flex items-center gap-1 flex-wrap">
                      {col.primary_key && <span className="badge badge-yellow" style={{ fontSize: 9 }}>PK</span>}
                      {col.foreign_key && (
                        <span className="badge badge-blue" style={{ fontSize: 9 }} title={col.foreign_key}>
                          FK → {col.foreign_key}
                        </span>
                      )}
                      {col.indexed && !col.primary_key && <span className="badge" style={{ fontSize: 9, background: 'hsl(var(--surface-raised))', color: 'hsl(var(--fg-muted))' }}>IDX</span>}
                      {!col.nullable && <span className="badge" style={{ fontSize: 9, background: 'hsl(var(--surface-raised))', color: 'hsl(var(--fg-subtle))' }}>NOT NULL</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   VIEW CARD
══════════════════════════════════════════════════════════════ */
function ViewCard({ view }: { view: ViewInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid hsl(var(--border))', background: 'hsl(var(--surface))' }}>
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 text-left transition-colors"
        style={{ background: open ? 'hsl(var(--primary-muted))' : 'transparent' }}
        onMouseEnter={e => { if (!open) (e.currentTarget as HTMLElement).style.background = 'hsl(var(--surface-raised))'; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
        <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
          style={{ background: 'hsl(var(--success) / 0.12)' }}>
          <Eye size={11} style={{ color: 'hsl(var(--success))' }} />
        </div>
        <span className="text-xs font-semibold flex-1 truncate" style={{ color: 'hsl(var(--fg))' }}>{view.view_name}</span>
        <span className="text-[10px] px-1.5 rounded-full mr-2" style={{ background: 'hsl(var(--surface-raised))', color: 'hsl(var(--fg-muted))' }}>
          {view.columns.length} cols
        </span>
        {open ? <ChevronDown size={13} style={{ color: 'hsl(var(--fg-muted))' }} />
               : <ChevronRight size={13} style={{ color: 'hsl(var(--fg-muted))' }} />}
      </button>
      {open && (
        <div className="px-3 pb-2.5 pt-2 anim-fade-up" style={{ borderTop: '1px solid hsl(var(--border))' }}>
          <div className="flex flex-wrap gap-1.5">
            {view.columns.map(col => (
              <span key={col.name} className="text-[10px] px-2 py-0.5 rounded-full font-mono"
                style={{ background: 'hsl(var(--surface-raised))', color: 'hsl(var(--fg-muted))', border: '1px solid hsl(var(--border))' }}>
                {col.name} <span style={{ color: 'hsl(var(--fg-subtle))' }}>{col.data_type}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   PROCEDURE CARD
══════════════════════════════════════════════════════════════ */
function ProcedureCard({ proc }: { proc: ProcedureInfo }) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl"
      style={{ background: 'hsl(var(--surface))', border: '1px solid hsl(var(--border))' }}>
      <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: 'hsl(var(--warning) / 0.12)' }}>
        <Code2 size={11} style={{ color: 'hsl(var(--warning))' }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-semibold" style={{ color: 'hsl(var(--fg))' }}>{proc.name}</span>
          <span className="badge" style={{ fontSize: 9, background: 'hsl(var(--warning-bg))', color: 'hsl(var(--warning))' }}>
            {proc.type}
          </span>
          {proc.return_type && (
            <span className="text-[10px]" style={{ color: 'hsl(var(--fg-subtle))' }}>→ {proc.return_type}</span>
          )}
        </div>
        {proc.parameters && (
          <p className="text-[10px] font-mono truncate" style={{ color: 'hsl(var(--fg-muted))' }}>
            ({proc.parameters})
          </p>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   DB EXPLORER CARD
══════════════════════════════════════════════════════════════ */
type SchemaTab = 'tables' | 'views' | 'procedures';

function DbExplorerCard({ db, onRemove, onRefresh }: {
  db: DatabaseConnection;
  onRemove: () => void;
  onRefresh: (schema: { tables: TableInfo[]; views: ViewInfo[]; procedures: ProcedureInfo[] }) => void;
}) {
  const [activeTab, setActiveTab]   = useState<SchemaTab>('tables');
  const [search, setSearch]         = useState('');
  const [expanded, setExpanded]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hintsOpen, setHintsOpen]   = useState(false);

  const info = DB_TYPES.find(t => t.value === db.type)!;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await axios.get(`/api/database/${db.id}/schema`);
      onRefresh(res.data);
    } catch (e) {
      console.error('Schema refresh failed', e);
    } finally {
      setRefreshing(false);
    }
  };

  const tables     = (db.tables     ?? []).filter(t => t.table_name.toLowerCase().includes(search.toLowerCase()));
  const views      = (db.views      ?? []).filter(v => v.view_name.toLowerCase().includes(search.toLowerCase()));
  const procedures = (db.procedures ?? []).filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  const tabMeta: { key: SchemaTab; label: string; icon: typeof Table2; count: number }[] = [
    { key: 'tables',     label: 'Tables',     icon: Table2,      count: db.tables?.length     ?? 0 },
    { key: 'views',      label: 'Views',      icon: Eye,         count: db.views?.length      ?? 0 },
    { key: 'procedures', label: 'Procedures', icon: Code2,       count: db.procedures?.length ?? 0 },
  ];

  return (
    <div className="card overflow-hidden">
      {/* DB Header */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--surface-raised))' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
          style={{ background: 'hsl(var(--surface))' }}>
          {info?.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-sm truncate" style={{ color: 'hsl(var(--fg))' }}>{db.name}</span>
            <span className="badge badge-blue">{info?.label}</span>
            <div className="w-2 h-2 rounded-full flex-shrink-0"
              style={{
                background: db.status === 'connected' ? 'hsl(var(--success))' : 'hsl(var(--danger))',
                boxShadow:  db.status === 'connected' ? '0 0 0 3px hsl(var(--success) / 0.2)' : '0 0 0 3px hsl(var(--danger) / 0.2)',
              }} />
          </div>
          <div className="text-xs truncate" style={{ color: 'hsl(var(--fg-muted))' }}>
            {db.host}:{db.port} / {db.database} · {db.username}
          </div>
        </div>

        {/* Stats */}
        <div className="hidden md:flex items-center gap-3 text-xs mr-2">
          {[
            { icon: Table2, val: db.tables?.length     ?? db.tablesCount     ?? 0, label: 'tables' },
            { icon: Eye,    val: db.views?.length      ?? db.viewsCount      ?? 0, label: 'views' },
            { icon: Code2,  val: db.procedures?.length ?? db.proceduresCount ?? 0, label: 'procs' },
          ].map(({ icon: Icon, val, label }) => (
            <div key={label} className="flex items-center gap-1" style={{ color: 'hsl(var(--fg-muted))' }}>
              <Icon size={11} />
              <span className="font-semibold" style={{ color: 'hsl(var(--fg))' }}>{val}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button onClick={handleRefresh} disabled={refreshing} title="Refresh schema"
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'hsl(var(--fg-subtle))' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'hsl(var(--primary))'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'hsl(var(--fg-subtle))'}>
            <RefreshCw size={13} className={refreshing ? 'anim-spin' : ''} />
          </button>
          <button
            onClick={() => setHintsOpen(true)}
            title="Teach the AI about mixed tables (sales vs returns, etc.)"
            className="p-1.5 rounded-lg transition-colors flex items-center gap-1"
            style={{ color: 'hsl(var(--fg-subtle))' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'hsl(var(--primary))'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'hsl(var(--fg-subtle))'}
          >
            <BookMarked size={13} />
          </button>
          <button onClick={onRemove} title="Disconnect"
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'hsl(var(--fg-subtle))' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'hsl(var(--danger))'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'hsl(var(--fg-subtle))'}>
            <Trash2 size={13} />
          </button>
          <button onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'hsl(var(--fg-subtle))' }}>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        </div>
      </div>

      {/* Schema explorer */}
      {expanded && (
        <div className="anim-fade-up">
          {/* Tabs + search */}
          <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid hsl(var(--border))' }}>
            <div className="flex items-center gap-1">
              {tabMeta.map(({ key, label, icon: Icon, count }) => (
                <button key={key} onClick={() => setActiveTab(key)}
                  className="flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: activeTab === key ? 'hsl(var(--primary))' : 'transparent',
                    color:      activeTab === key ? 'white' : 'hsl(var(--fg-muted))',
                  }}
                  onMouseEnter={e => { if (activeTab !== key) (e.currentTarget as HTMLElement).style.background = 'hsl(var(--surface-raised))'; }}
                  onMouseLeave={e => { if (activeTab !== key) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  <Icon size={11} />
                  {label}
                  <span className="text-[10px] px-1 rounded-full"
                    style={{
                      background: activeTab === key ? 'rgba(255,255,255,0.2)' : 'hsl(var(--surface-raised))',
                      color:      activeTab === key ? 'white' : 'hsl(var(--fg-subtle))',
                    }}>
                    {count}
                  </span>
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="ml-auto flex items-center gap-1.5 px-2.5 h-7 rounded-lg"
              style={{ background: 'hsl(var(--surface-raised))', border: '1px solid hsl(var(--border))', minWidth: 160 }}>
              <Search size={11} style={{ color: 'hsl(var(--fg-subtle))' }} />
              <input
                className="bg-transparent outline-none text-xs flex-1"
                style={{ color: 'hsl(var(--fg))' }}
                placeholder={`Search ${activeTab}…`}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Content */}
          <div className="p-3" style={{ maxHeight: 480, overflowY: 'auto' }}>
            {activeTab === 'tables' && (
              tables.length === 0
                ? <EmptyState icon={Table2} msg={search ? `No tables matching "${search}"` : 'No tables found'} />
                : <div className="flex flex-col gap-2">
                    {tables.map(t => <TableCard key={t.table_name} table={t} />)}
                  </div>
            )}

            {activeTab === 'views' && (
              views.length === 0
                ? <EmptyState icon={Eye} msg={search ? `No views matching "${search}"` : 'No views found'} />
                : <div className="flex flex-col gap-2">
                    {views.map(v => <ViewCard key={v.view_name} view={v} />)}
                  </div>
            )}

            {activeTab === 'procedures' && (
              procedures.length === 0
                ? <EmptyState icon={Code2} msg={search ? `No procedures matching "${search}"` : 'No stored procedures found'} />
                : <div className="flex flex-col gap-2">
                    {procedures.map(p => <ProcedureCard key={p.name} proc={p} />)}
                  </div>
            )}
          </div>
        </div>
      )}

      {hintsOpen && <TableHintsModal db={db} onClose={() => setHintsOpen(false)} />}
    </div>
  );
}

function EmptyState({ icon: Icon, msg }: { icon: typeof Table2; msg: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10">
      <Icon size={20} style={{ color: 'hsl(var(--fg-subtle))', marginBottom: 8 }} />
      <p className="text-xs" style={{ color: 'hsl(var(--fg-muted))' }}>{msg}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   AUTO-GENERATE DASHBOARD MODAL
══════════════════════════════════════════════════════════════ */

function buildSchemaText(db: DatabaseConnection): string {
  if (!db.tables?.length) return '';
  return db.tables.map((t: TableInfo) => {
    const cols = t.columns.map((c) => {
      const flags: string[] = [];
      if (c.primary_key) flags.push('PRIMARY KEY');
      if (c.foreign_key) flags.push(`FK -> ${c.foreign_key}`);
      if (!c.nullable)   flags.push('NOT NULL');
      return `  - ${c.name} (${c.data_type})${flags.length ? ` [${flags.join(', ')}]` : ''}`;
    }).join('\n');
    return `Table: ${t.table_name}\nColumns:\n${cols}`;
  }).join('\n\n---\n\n');
}

type GenStage = 'planning' | 'executing' | 'saving' | 'done' | 'error';

const STAGE_INFO: Record<GenStage, { label: string; sub: string }> = {
  planning:  { label: 'Analyzing your database…',     sub: 'AI is reading the schema and planning the dashboard' },
  executing: { label: 'Fetching real data…',           sub: 'Running SQL queries for each chart' },
  saving:    { label: 'Building dashboard…',           sub: 'Creating tabs and charts in your workspace' },
  done:      { label: 'Dashboard ready!',              sub: 'Redirecting you to the builder…' },
  error:     { label: 'Something went wrong',          sub: 'Check the error below and try again' },
};

function AutoGenerateModal({
  db, onClose,
}: { db: DatabaseConnection; onClose: () => void }) {
  const {
    addDashboard, setActiveDashboard,
    addTab, setActiveTab,
    addChart, setActiveDatabaseId,
  } = useAppStore();
  const navigate = useNavigate();

  const [stage, setStage]       = useState<GenStage | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [errMsg, setErrMsg]     = useState('');
  const [result, setResult]     = useState<{ tabCount: number; chartCount: number } | null>(null);

  const addLog = (msg: string) => setProgress(p => [...p, msg]);

  const handleGenerate = async () => {
    setStage('planning');
    setProgress([]);
    setErrMsg('');

    try {
      const schemaContext = buildSchemaText(db);
      if (!schemaContext) {
        setErrMsg('No schema found. Please refresh the database connection first.');
        setStage('error');
        return;
      }

      addLog(`Connected to "${db.name}" — ${db.tables?.length ?? 0} tables found`);
      addLog('Sending schema to AI planner…');

      const res = await axios.post('/api/ai/auto-dashboard', {
        db_id:          db.id,
        schema_context: schemaContext,
      });

      const plan = res.data;
      const tabs: { name: string; charts: { title: string; type: string; sql: string; data: unknown[]; columns: string[]; x_key?: string; y_key?: string; error?: string }[] }[] = plan.tabs ?? [];

      addLog(`✓ Plan ready: "${plan.dashboard_name}" — ${tabs.length} tabs`);
      setStage('executing');

      const successCharts: number = tabs.reduce((n, t) =>
        n + t.charts.filter(c => c.data?.length > 0).length, 0);
      addLog(`✓ ${successCharts} charts with real data`);

      tabs.forEach(t => {
        const ok  = t.charts.filter(c => c.data?.length > 0).length;
        const err = t.charts.filter(c => c.error).length;
        addLog(`  Tab "${t.name}": ${ok} charts OK${err ? `, ${err} skipped` : ''}`);
      });

      setStage('saving');
      addLog('Saving dashboard to workspace…');

      // Create dashboard
      const dashboardId = `dash-${Date.now()}`;
      const now = new Date().toISOString();

      addDashboard({
        id:          dashboardId,
        name:        plan.dashboard_name,
        description: `Auto-generated from ${db.name}`,
        tabs:        [],
        createdAt:   now,
        updatedAt:   now,
      });

      let firstTabId: string | null = null;
      let totalCharts = 0;

      for (const tabDef of tabs) {
        const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        if (!firstTabId) firstTabId = tabId;

        addTab(dashboardId, {
          id:       tabId,
          name:     tabDef.name,
          filters:  {},
          gridCols: 'auto',
        });

        const validCharts = tabDef.charts.filter(c => c.data?.length > 0);
        validCharts.forEach((c, idx) => {
          const chartId: string = `chart-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const chartData: ChartData = {
            id:          chartId,
            title:       c.title,
            type:        (c.type as ChartType) ?? 'bar',
            query:       c.sql,
            data:        c.data as Record<string, unknown>[],
            columns:     c.columns,
            xKey:        c.x_key,
            yKey:        c.y_key,
            order:       idx,
            tabId,
            dashboardId,
            createdAt:   now,
          };
          addChart(chartData);
          totalCharts++;
        });
      }

      // Activate the new dashboard
      setActiveDashboard(dashboardId);
      if (firstTabId) setActiveTab(firstTabId);
      setActiveDatabaseId(db.id);

      setResult({ tabCount: tabs.length, chartCount: totalCharts });
      setStage('done');
      addLog(`✓ Dashboard created with ${totalCharts} charts across ${tabs.length} tabs`);

      setTimeout(() => {
        navigate(`/builder?dashboard=${dashboardId}`);
      }, 1500);

    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? (err instanceof Error ? err.message : 'Unknown error');
      setErrMsg(msg);
      setStage('error');
    }
  };

  const isRunning = stage === 'planning' || stage === 'executing' || stage === 'saving';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-md rounded-2xl flex flex-col overflow-hidden anim-scale-in"
        style={{ background: 'hsl(var(--surface))', border: '1px solid hsl(var(--border))' }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4"
          style={{ borderBottom: '1px solid hsl(var(--border))' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'hsl(var(--primary-muted))' }}>
            <Sparkles size={16} style={{ color: 'hsl(var(--primary))' }} />
          </div>
          <div>
            <div className="text-sm font-bold" style={{ color: 'hsl(var(--fg))' }}>
              Auto-Generate Dashboard
            </div>
            <div className="text-xs" style={{ color: 'hsl(var(--fg-muted))' }}>
              {db.name} · {db.tables?.length ?? 0} tables
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4">
          {/* Stage info */}
          {stage && (
            <div className="flex items-start gap-3 p-3 rounded-xl"
              style={{
                background: stage === 'error'
                  ? 'hsl(var(--danger-bg))'
                  : stage === 'done'
                  ? 'hsl(var(--success-bg))'
                  : 'hsl(var(--primary-light))',
                border: `1px solid ${stage === 'error' ? 'hsl(var(--danger) / 0.2)' : stage === 'done' ? 'hsl(var(--success) / 0.2)' : 'hsl(var(--primary) / 0.2)'}`,
              }}>
              <div className="mt-0.5">
                {isRunning && <Loader2 size={15} className="anim-spin" style={{ color: 'hsl(var(--primary))' }} />}
                {stage === 'done'  && <CheckCheck size={15} style={{ color: 'hsl(var(--success))' }} />}
                {stage === 'error' && <AlertCircle size={15} style={{ color: 'hsl(var(--danger))' }} />}
              </div>
              <div>
                <div className="text-xs font-semibold"
                  style={{ color: stage === 'error' ? 'hsl(var(--danger))' : stage === 'done' ? 'hsl(var(--success))' : 'hsl(var(--primary))' }}>
                  {STAGE_INFO[stage].label}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'hsl(var(--fg-muted))' }}>
                  {stage === 'error' ? errMsg : STAGE_INFO[stage].sub}
                </div>
              </div>
            </div>
          )}

          {/* Preview description (before starting) */}
          {!stage && (
            <div className="flex flex-col gap-3">
              <p className="text-xs leading-relaxed" style={{ color: 'hsl(var(--fg-muted))' }}>
                AI will analyze your <strong style={{ color: 'hsl(var(--fg))' }}>{db.name}</strong> database
                and automatically create a complete dashboard with:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { icon: BarChart2, text: '3–4 dashboard tabs'    },
                  { icon: Sparkles,  text: '2–3 charts per tab'    },
                  { icon: CheckCheck,text: 'Real data from your DB'},
                  { icon: Database,  text: 'Smart chart selection' },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-2 p-2 rounded-lg"
                    style={{ background: 'hsl(var(--surface-raised))', border: '1px solid hsl(var(--border))' }}>
                    <Icon size={12} style={{ color: 'hsl(var(--primary))', flexShrink: 0 }} />
                    <span className="text-[11px]" style={{ color: 'hsl(var(--fg-muted))' }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Progress log */}
          {progress.length > 0 && (
            <div className="rounded-xl p-3 max-h-36 overflow-y-auto"
              style={{ background: 'hsl(var(--bg))', border: '1px solid hsl(var(--border))' }}>
              {progress.map((log, i) => (
                <div key={i} className="text-[11px] font-mono py-0.5"
                  style={{ color: log.startsWith('✓') ? 'hsl(var(--success))' : 'hsl(var(--fg-muted))' }}>
                  {log}
                </div>
              ))}
            </div>
          )}

          {/* Result summary */}
          {result && (
            <div className="flex items-center justify-center gap-6 py-2">
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ color: 'hsl(var(--primary))' }}>{result.tabCount}</div>
                <div className="text-[10px]" style={{ color: 'hsl(var(--fg-muted))' }}>Tabs created</div>
              </div>
              <div className="w-px h-8" style={{ background: 'hsl(var(--border))' }} />
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ color: 'hsl(var(--success))' }}>{result.chartCount}</div>
                <div className="text-[10px]" style={{ color: 'hsl(var(--fg-muted))' }}>Charts with real data</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4"
          style={{ borderTop: '1px solid hsl(var(--border))' }}>
          <button onClick={onClose} disabled={isRunning}
            className="flex-1 h-9 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: 'hsl(var(--surface-raised))',
              border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--fg-muted))',
              opacity: isRunning ? 0.5 : 1,
            }}>
            {stage === 'done' ? 'Close' : 'Cancel'}
          </button>

          {(!stage || stage === 'error') && (
            <button onClick={handleGenerate} disabled={isRunning}
              className="flex-1 btn-primary h-9 rounded-lg text-sm font-semibold flex items-center justify-center gap-2">
              <Sparkles size={14} />
              {stage === 'error' ? 'Try Again' : 'Generate Dashboard'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════ */
export function DatabasesPage() {
  const { databases, addDatabase, removeDatabase, updateDatabase } = useAppStore();
  const [showModal, setShowModal]     = useState(false);
  const [autoGenDb, setAutoGenDb]     = useState<DatabaseConnection | null>(null);

  const handleRefresh = (
    dbId: string,
    schema: { tables: TableInfo[]; views: ViewInfo[]; procedures: ProcedureInfo[] },
  ) => {
    updateDatabase(dbId, {
      tables:          schema.tables,
      views:           schema.views,
      procedures:      schema.procedures,
      tablesCount:     schema.tables.length,
      viewsCount:      schema.views.length,
      proceduresCount: schema.procedures.length,
    });
  };

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Page header — stack on narrow screens so Connect stays visible and tappable */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 mb-8">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'hsl(var(--fg))' }}>Databases</h1>
          <p className="text-sm leading-relaxed max-w-3xl" style={{ color: 'hsl(var(--fg-muted))' }}>
            Connect and explore your database schema — tables, views, and stored procedures. On each connection, use
            the bookmark button to teach the AI how mixed tables work (discriminators like IrType, row counts, and plain
            English descriptions).
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="btn-primary inline-flex items-center justify-center gap-2 h-10 px-5 rounded-lg text-sm font-semibold shrink-0 w-full sm:w-auto sm:min-w-[200px] shadow-sm"
        >
          <Plus size={16} strokeWidth={2.25} aria-hidden />
          Connect database
        </button>
      </header>

      {/* Feature highlights */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { icon: ShieldCheck, title: 'Schema Only',   desc: 'Only structure is sent to AI — never your actual data', color: '#22c55e' },
          { icon: Server,      title: 'Multi-DB',      desc: 'Connect PostgreSQL and SQL Server simultaneously',      color: 'hsl(var(--primary))' },
          { icon: LayoutList,  title: 'Full Explorer', desc: 'Browse tables, views and stored procedures inline',     color: '#f59e0b' },
        ].map(({ icon: Icon, title, desc, color }) => (
          <div key={title} className="card p-4">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
              style={{ background: `${color}18` }}>
              <Icon size={16} style={{ color }} />
            </div>
            <div className="text-sm font-semibold mb-1" style={{ color: 'hsl(var(--fg))' }}>{title}</div>
            <div className="text-xs" style={{ color: 'hsl(var(--fg-muted))' }}>{desc}</div>
          </div>
        ))}
      </div>

      {/* Connected databases */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
        <h2 className="text-xs font-semibold tracking-wide" style={{ color: 'hsl(var(--fg-muted))' }}>
          CONNECTED DATABASES ({databases.length})
        </h2>
        {databases.length > 0 && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold shrink-0 self-start sm:self-auto w-full sm:w-auto"
            style={{
              background: 'hsl(var(--surface-raised))',
              border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--fg))',
            }}
          >
            <Plus size={14} aria-hidden />
            Add another connection
          </button>
        )}
      </div>

      {databases.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16" style={{ borderStyle: 'dashed' }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
            style={{ background: 'hsl(var(--primary-light))' }}>
            <Database size={20} style={{ color: 'hsl(var(--primary))' }} />
          </div>
          <h3 className="text-sm font-semibold mb-1" style={{ color: 'hsl(var(--fg))' }}>No databases connected</h3>
          <p className="text-xs mb-5 text-center max-w-xs" style={{ color: 'hsl(var(--fg-muted))' }}>
            Connect a database to explore its schema and build AI-powered charts
          </p>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="btn-primary inline-flex items-center justify-center gap-2 h-10 px-6 rounded-lg text-sm font-semibold w-full max-w-xs shadow-sm"
          >
            <Plus size={16} strokeWidth={2.25} aria-hidden />
            Connect database
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {databases.map(db => (
            <div key={db.id} className="flex flex-col gap-2">
              {/* Auto-generate banner */}
              <div className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                style={{
                  background: 'hsl(var(--primary-light))',
                  border: '1px solid hsl(var(--primary) / 0.2)',
                }}>
                <div className="flex items-center gap-2">
                  <Sparkles size={13} style={{ color: 'hsl(var(--primary))' }} />
                  <span className="text-xs font-medium" style={{ color: 'hsl(var(--fg))' }}>
                    Let AI build a full dashboard from <strong>{db.name}</strong>
                  </span>
                </div>
                <button
                  onClick={() => setAutoGenDb(db)}
                  className="btn-primary flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-semibold"
                >
                  <Sparkles size={11} /> Generate Dashboard
                </button>
              </div>

              <DbExplorerCard
                db={db}
                onRemove={() => removeDatabase(db.id)}
                onRefresh={schema => handleRefresh(db.id, schema)}
              />
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <ConnectModal
          onClose={() => setShowModal(false)}
          onConnected={db => { addDatabase(db); setShowModal(false); }}
        />
      )}

      {autoGenDb && (
        <AutoGenerateModal
          db={autoGenDb}
          onClose={() => setAutoGenDb(null)}
        />
      )}
    </div>
  );
}
