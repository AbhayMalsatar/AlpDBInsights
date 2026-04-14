import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Bot, User, Database, Loader2, Wand2,
  ChevronDown, X, Code, CheckCircle2, AlertCircle,
  Table2, BarChart2, HelpCircle, Sparkles, Info,
  MessageCircle,
} from 'lucide-react';
import axios from 'axios';
import { useAppStore } from '../../store/useAppStore';
import type {
  ChartType, ChatMessage, ChartData, DatabaseConnection,
} from '../../store/useAppStore';

/* ── Loading stage type ───────────────────────────────────────── */
type Stage =
  | 'idle'
  | 'understanding'
  | 'generating_sql'
  | 'querying_db'
  | 'building_chart';

const STAGE_LABELS: Record<Stage, string> = {
  idle:           '',
  understanding:  'Understanding your request…',
  generating_sql: 'Generating SQL query…',
  querying_db:    'Querying database…',
  building_chart: 'Building chart…',
};

/* ── Quick prompts per schema type ───────────────────────────── */
function getQuickPrompts(db: DatabaseConnection | undefined): string[] {
  if (!db?.tables?.length) return [
    'Show top 10 products by revenue',
    'Monthly sales trend',
    'Sales breakdown by category',
  ];
  const tableNames = db.tables.map((t) => t.table_name.toLowerCase());

  if (tableNames.includes('orders') && tableNames.includes('products')) {
    return [
      'Top 10 products by quantity ordered',
      'Monthly order revenue trend',
      'Orders count by country',
    ];
  }
  if (tableNames.includes('sales') && tableNames.includes('items')) {
    return [
      'Create sales chart item wise',
      'Monthly sales trend',
      'Stock level by category',
    ];
  }
  return [
    `Show top 10 from ${tableNames[0] ?? 'data'}`,
    'Monthly trend',
    'Distribution by category',
  ];
}

/* ── Message type icon & color ────────────────────────────────── */
function getMessageStyle(messageType?: string, isError?: boolean) {
  if (isError || messageType === 'error') return {
    bg:    'hsl(var(--danger-bg))',
    color: 'hsl(var(--danger))',
    icon:  AlertCircle,
    border: 'hsl(var(--danger) / 0.2)',
  };
  if (messageType === 'clarification') return {
    bg:    'hsl(var(--warning-bg, 45 100% 95%))',
    color: 'hsl(var(--warning, 35 90% 40%))',
    icon:  HelpCircle,
    border: 'hsl(var(--warning, 35 90% 40%) / 0.2)',
  };
  if (messageType === 'greeting' || messageType === 'thanks') return {
    bg:    'hsl(var(--primary-light))',
    color: 'hsl(var(--primary))',
    icon:  Sparkles,
    border: 'hsl(var(--primary) / 0.2)',
  };
  if (messageType === 'help') return {
    bg:    'hsl(var(--surface-raised))',
    color: 'hsl(var(--fg))',
    icon:  Info,
    border: 'hsl(var(--border))',
  };
  if (messageType === 'chart') return {
    bg:    'hsl(var(--surface-raised))',
    color: 'hsl(var(--fg))',
    icon:  BarChart2,
    border: 'hsl(var(--border))',
  };
  if (messageType === 'info') return {
    bg:    'hsl(var(--surface-raised))',
    color: 'hsl(var(--fg))',
    icon:  Info,
    border: 'hsl(var(--border))',
  };
  return {
    bg:    'hsl(var(--surface-raised))',
    color: 'hsl(var(--fg))',
    icon:  Bot,
    border: 'hsl(var(--border))',
  };
}

/* ─────────────────────────────────────────────────────────────── */

interface Props {
  dashboardId: string;
  activeTabId: string | null;
}

export function BuilderChat({ dashboardId, activeTabId }: Props) {
  const {
    chatMessages, addChatMessage,
    databases, activeDatabaseId, setActiveDatabaseId,
    addChart, charts, dashboards,
  } = useAppStore();

  const [input, setInput]     = useState('');
  const [stage, setStage]     = useState<Stage>('idle');
  const [dbOpen, setDbOpen]   = useState(false);
  const [expandSql, setExpandSql] = useState<string | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);

  const loading   = stage !== 'idle';
  const activeDb  = databases.find((d) => d.id === activeDatabaseId);
  const usedTableCount = activeDb
    ? (activeDb.selectedTables?.length ?? activeDb.tables?.length ?? 0)
    : 0;
  const dashboard = dashboards.find((d) => d.id === dashboardId);
  const activeTab = dashboard?.tabs.find((t) => t.id === activeTabId);

  const messages = chatMessages.filter((m) =>
    m.id.startsWith(`${dashboardId}-`),
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, stage]);

  const pushMsg = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    addChatMessage({
      ...msg,
      id: `${dashboardId}-${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
    });
  }, [addChatMessage, dashboardId]);

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    setInput('');
    pushMsg({ role: 'user', content, messageType: 'user' });

    if (!activeTabId) {
      pushMsg({
        role: 'assistant',
        content: 'Please select or create a tab first — use the sidebar on the left.',
        messageType: 'info',
        suggestions: [],
      });
      return;
    }

    setStage('understanding');

    try {
      let chartData: ChartData | null = null;

      if (activeDb) {
        /* ── Real AI pipeline ── */
        const filters       = activeTab?.filters ?? {};

        setStage('generating_sql');
        const res = await axios.post('/api/ai/chat', {
          message:        content,
          db_id:          activeDatabaseId,
          tab_id:         activeTabId,
          filters: {
            date_from: filters.dateFrom,
            date_to:   filters.dateTo,
            branch:    filters.branch,
            item:      filters.item,
          },
        });

        const d = res.data;
        const msgType: string = d.type ?? (d.error ? 'error' : 'chart');
        const suggestions: string[] = d.suggestions ?? [];

        // Non-chart responses (greeting, clarification, error, info, help, thanks)
        if (!d.data?.length || msgType === 'clarification' || msgType === 'error'
            || msgType === 'greeting' || msgType === 'thanks' || msgType === 'help'
            || msgType === 'info') {
          pushMsg({
            role:        'assistant',
            content:     d.message ?? 'Got it!',
            messageType: msgType,
            suggestions,
            tokenUsage:  d.token_usage,
          });
          setStage('idle');
          return;
        }

        setStage('querying_db');
        await new Promise(r => setTimeout(r, 250));

        if (d.chart && d.data?.length) {
          setStage('building_chart');
          await new Promise(r => setTimeout(r, 200));

          chartData = {
            id:          `chart-${Date.now()}`,
            title:       d.chart.title ?? content,
            type:        (d.chart.type as ChartType) ?? 'bar',
            query:       d.sql ?? '',
            data:        d.data ?? [],
            columns:     d.columns ?? [],
            xKey:        d.chart.x_key,
            yKey:        d.chart.y_key,
            order:       charts.filter((c) => c.tabId === activeTabId).length,
            tabId:       activeTabId,
            dashboardId,
            createdAt:   new Date().toISOString(),
          };
        }

        const sqlNote = d.sql ? `\`\`\`sql\n${d.sql}\n\`\`\`` : '';

        pushMsg({
          role:        'assistant',
          content:     d.message ?? (chartData ? `Chart created: ${chartData.title}` : 'Done!'),
          messageType: 'chart',
          chartId:     chartData?.id,
          suggestions,
          tokenUsage:  d.token_usage,
          // Embed SQL in content for the toggle
          ...(sqlNote ? { content: (d.message ?? '') + (sqlNote ? '\n\n' + sqlNote : '') } : {}),
        });

      } else {
        /* ── Mock fallback (no DB selected) ── */
        await new Promise(r => setTimeout(r, 600));
        setStage('building_chart');
        await new Promise(r => setTimeout(r, 200));

        chartData = buildMockChart(content, activeTabId, dashboardId, charts.length);
        pushMsg({
          role:        'assistant',
          content:     `Here's a sample **${chartData.title}** chart with mock data.`,
          messageType: 'chart',
          chartId:     chartData.id,
          suggestions: [
            'Connect a database for real data',
            'Try: monthly revenue trend',
            'Try: top products by sales',
          ],
        });
      }

      if (chartData) addChart(chartData);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string; message?: string } } };
      const errMsg   = axiosErr?.response?.data?.detail
        ?? axiosErr?.response?.data?.message
        ?? (err instanceof Error ? err.message : 'Something went wrong.');
      pushMsg({
        role:        'assistant',
        content:     `Something went wrong: ${errMsg}`,
        messageType: 'error',
        suggestions: [
          'Try rephrasing your request',
          'Check that your database is connected',
          'Try: show top 10 products',
        ],
      });
    } finally {
      setStage('idle');
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const quickPrompts = getQuickPrompts(activeDb);

  return (
    <div style={{
      width: 320, display: 'flex', flexDirection: 'column',
      background: 'hsl(var(--surface))',
      borderLeft: '1px solid hsl(var(--border))',
      height: '100%', overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div className="flex items-center gap-2.5 px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid hsl(var(--border))' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'hsl(var(--primary-muted))' }}>
          <Wand2 size={13} style={{ color: 'hsl(var(--primary))' }} />
        </div>
        <span className="text-sm font-semibold flex-1" style={{ color: 'hsl(var(--fg))' }}>
          AI Assistant
        </span>

        {/* DB Selector */}
        <div className="relative">
          <button onClick={() => setDbOpen(v => !v)}
            className="flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-xs transition-all"
            style={{
              background: activeDb ? 'hsl(var(--primary-muted))' : 'hsl(var(--surface-raised))',
              border:     '1px solid hsl(var(--border))',
              color:      activeDb ? 'hsl(var(--primary))' : 'hsl(var(--fg-muted))',
            }}>
            <Database size={11} />
            <span className="max-w-[70px] truncate">{activeDb ? activeDb.name : 'No DB'}</span>
            <ChevronDown size={10} />
          </button>

          {dbOpen && (
            <div className="absolute right-0 top-8 z-50 rounded-xl overflow-hidden anim-scale-in"
              style={{
                background: 'hsl(var(--surface-raised))',
                border: '1px solid hsl(var(--border))',
                minWidth: 200,
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              }}>
              <div className="px-3 py-2 text-[10px] font-semibold tracking-wide"
                style={{ color: 'hsl(var(--fg-subtle))', borderBottom: '1px solid hsl(var(--border))' }}>
                SELECT DATABASE
              </div>
              <button
                className="flex items-center gap-2 w-full px-3 py-2 text-xs"
                style={{ color: 'hsl(var(--fg-muted))' }}
                onClick={() => { setActiveDatabaseId(null); setDbOpen(false); }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'hsl(var(--surface))'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                <X size={10} /> Mock data only
              </button>
              {databases.length === 0 && (
                <div className="px-3 py-2.5 text-xs italic" style={{ color: 'hsl(var(--fg-subtle))' }}>
                  No databases connected
                </div>
              )}
              {databases.map(db => (
                <button key={db.id}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs"
                  style={{
                    color:      activeDatabaseId === db.id ? 'hsl(var(--primary))' : 'hsl(var(--fg))',
                    background: activeDatabaseId === db.id ? 'hsl(var(--primary-muted))' : 'transparent',
                  }}
                  onClick={() => { setActiveDatabaseId(db.id); setDbOpen(false); }}
                  onMouseEnter={e => { if (activeDatabaseId !== db.id) (e.currentTarget as HTMLElement).style.background = 'hsl(var(--surface))'; }}
                  onMouseLeave={e => { if (activeDatabaseId !== db.id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  <Database size={10} />
                  <span className="flex-1 truncate text-left">{db.name}</span>
                  <span className="flex-shrink-0 text-[10px] px-1.5 rounded-full"
                    style={{
                      background: db.status === 'connected' ? 'hsl(var(--success-bg))' : 'hsl(var(--danger-bg))',
                      color:      db.status === 'connected' ? 'hsl(var(--success))'    : 'hsl(var(--danger))',
                    }}>
                    {db.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── DB schema hint strip ── */}
      {activeDb && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0"
          style={{ background: 'hsl(var(--primary-light))', borderBottom: '1px solid hsl(var(--primary-muted))' }}>
          <CheckCircle2 size={10} style={{ color: 'hsl(var(--primary))', flexShrink: 0 }} />
          <span className="text-[10px] truncate" style={{ color: 'hsl(var(--primary))' }}>
            {activeDb.name} · {usedTableCount} used tables · Schema ready
          </span>
        </div>
      )}

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {messages.length === 0 && (
          <EmptyState activeDb={activeDb} onSend={handleSend} />
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            expandSql={expandSql}
            setExpandSql={setExpandSql}
            onSuggestionClick={handleSend}
            loading={loading}
          />
        ))}

        {/* Stage indicator */}
        {loading && (
          <div className="flex gap-2 anim-fade-in">
            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'hsl(var(--surface-raised))', border: '1px solid hsl(var(--border))' }}>
              <Bot size={11} style={{ color: 'hsl(var(--primary))' }} />
            </div>
            <div className="px-3 py-2 rounded-xl text-xs flex items-center gap-2"
              style={{ background: 'hsl(var(--surface-raised))', border: '1px solid hsl(var(--border))' }}>
              <Loader2 size={11} className="anim-spin flex-shrink-0" style={{ color: 'hsl(var(--primary))' }} />
              <span style={{ color: 'hsl(var(--fg-muted))' }}>{STAGE_LABELS[stage]}</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Quick prompts ── */}
      <div className="px-3 pb-2 flex-shrink-0"
        style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: 8 }}>
        <p className="text-[10px] mb-1.5 font-semibold tracking-wide"
          style={{ color: 'hsl(var(--fg-subtle))' }}>
          QUICK PROMPTS
        </p>
        <div className="flex flex-col gap-1">
          {quickPrompts.slice(0, 3).map(q => (
            <button key={q} onClick={() => handleSend(q)} disabled={loading}
              className="text-left px-2.5 py-1.5 rounded-lg text-[11px] transition-all"
              style={{
                background: 'hsl(var(--surface-raised))',
                border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--fg-muted))',
                opacity: loading ? 0.5 : 1,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'hsl(var(--primary) / 0.4)';
                (e.currentTarget as HTMLElement).style.color = 'hsl(var(--fg))';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'hsl(var(--border))';
                (e.currentTarget as HTMLElement).style.color = 'hsl(var(--fg-muted))';
              }}>
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* ── Input ── */}
      <div className="p-3 flex-shrink-0" style={{ borderTop: '1px solid hsl(var(--border))' }}>
        <div className="flex gap-2 items-end rounded-xl p-2"
          style={{
            background: 'hsl(var(--surface-raised))',
            border: `1px solid ${loading ? 'hsl(var(--primary) / 0.3)' : 'hsl(var(--border))'}`,
            transition: 'border-color 0.15s',
          }}>
          <textarea ref={inputRef}
            className="flex-1 bg-transparent text-xs resize-none outline-none"
            style={{
              color: 'hsl(var(--fg))',
              minHeight: 36, maxHeight: 100,
              fontFamily: 'inherit', lineHeight: 1.5,
            }}
            placeholder={
              !activeTabId ? 'Select a tab first…' :
              !activeDb    ? 'Ask anything (mock data)…' :
              `Ask me anything about ${activeDb.name}…`
            }
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
            disabled={!activeTabId || loading}
          />
          <button onClick={() => handleSend()}
            disabled={!input.trim() || loading || !activeTabId}
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
            style={{
              background: input.trim() && activeTabId && !loading
                ? 'hsl(var(--primary))' : 'hsl(var(--border))',
              color: input.trim() && activeTabId && !loading
                ? 'white' : 'hsl(var(--fg-subtle))',
            }}>
            {loading
              ? <Loader2 size={13} className="anim-spin" />
              : <Send size={13} />}
          </button>
        </div>
        <p className="text-center mt-1.5 text-[9px]" style={{ color: 'hsl(var(--fg-subtle))' }}>
          Powered by AI · Press Enter to send
        </p>
      </div>
    </div>
  );
}

/* ── Empty State ──────────────────────────────────────────────── */
function EmptyState({
  activeDb,
  onSend,
}: {
  activeDb: DatabaseConnection | undefined;
  onSend: (text: string) => void;
}) {
  const starters = activeDb ? [
    `What tables does ${activeDb.name} have?`,
    `Show top 10 records`,
    `Monthly trend`,
  ] : [
    'Show sample sales chart',
    'Monthly revenue trend',
    'Top products by quantity',
  ];

  return (
    <div className="flex flex-col items-center text-center pt-4 pb-2 gap-4">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ background: 'hsl(var(--primary-light))' }}>
        <MessageCircle size={22} style={{ color: 'hsl(var(--primary))' }} />
      </div>
      <div>
        <p className="text-sm font-semibold mb-1" style={{ color: 'hsl(var(--fg))' }}>
          {activeDb ? `Hi! I know ${activeDb.name} 👋` : 'AI Chart Assistant'}
        </p>
        <p className="text-xs" style={{ color: 'hsl(var(--fg-muted))' }}>
          {activeDb
            ? `I can query your ${activeDb.selectedTables?.length ?? activeDb.tables?.length ?? 0} used tables. Ask me anything in plain English!`
            : 'Select a database or ask me to create a chart with sample data.'}
        </p>
      </div>
      <div className="w-full flex flex-col gap-1.5">
        {starters.map(s => (
          <button key={s} onClick={() => onSend(s)}
            className="w-full text-left px-3 py-2 rounded-xl text-xs transition-all"
            style={{
              background: 'hsl(var(--surface-raised))',
              border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--fg-muted))',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'hsl(var(--primary) / 0.4)';
              (e.currentTarget as HTMLElement).style.color = 'hsl(var(--fg))';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'hsl(var(--border))';
              (e.currentTarget as HTMLElement).style.color = 'hsl(var(--fg-muted))';
            }}>
            ✦ {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Message Bubble ───────────────────────────────────────────── */
function MessageBubble({
  msg, expandSql, setExpandSql, onSuggestionClick, loading,
}: {
  msg: ChatMessage;
  expandSql: string | null;
  setExpandSql: (id: string | null) => void;
  onSuggestionClick: (text: string) => void;
  loading: boolean;
}) {
  const isUser      = msg.role === 'user';
  const isError     = msg.content.startsWith('❌') || msg.messageType === 'error';
  const style       = isUser ? null : getMessageStyle(msg.messageType, isError);
  const sqlMatch    = msg.content.match(/```sql\n([\s\S]+?)\n```/);
  const sqlCode     = sqlMatch?.[1];
  const cleanText   = msg.content.replace(/```sql\n[\s\S]+?\n```/, '').trim();
  const sqlExpanded = expandSql === msg.id;
  const suggestions = msg.suggestions ?? [];
  const tokenUsage  = msg.tokenUsage;

  /* Render text with basic markdown: **bold** */
  const renderText = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) =>
      part.startsWith('**') && part.endsWith('**')
        ? <strong key={i}>{part.slice(2, -2)}</strong>
        : <span key={i}>{part}</span>,
    );
  };

  if (isUser) {
    return (
      <div className="flex gap-2 flex-row-reverse">
        <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ background: 'hsl(var(--primary))' }}>
          <User size={11} color="white" />
        </div>
        <div className="max-w-[225px]">
          <div className="px-3 py-2 rounded-xl text-xs"
            style={{
              background: 'hsl(var(--primary))',
              color: 'white',
              lineHeight: 1.55,
            }}>
            {msg.content}
          </div>
        </div>
      </div>
    );
  }

  const StyleIcon = style?.icon ?? Bot;

  return (
    <div className="flex gap-2 flex-row anim-fade-up">
      {/* Avatar */}
      <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{
          background: style?.bg ?? 'hsl(var(--surface-raised))',
          border: `1px solid ${style?.border ?? 'hsl(var(--border))'}`,
        }}>
        <StyleIcon size={11} style={{ color: style?.color ?? 'hsl(var(--primary))' }} />
      </div>

      {/* Content */}
      <div className="max-w-[235px] flex flex-col gap-1.5 min-w-0">
        {/* Main bubble */}
        <div className="px-3 py-2 rounded-xl text-xs"
          style={{
            background: style?.bg ?? 'hsl(var(--surface-raised))',
            color:      style?.color ?? 'hsl(var(--fg))',
            border:     `1px solid ${style?.border ?? 'hsl(var(--border))'}`,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}>
          {renderText(cleanText)}
        </div>

        {/* Token usage */}
        {tokenUsage && (
          <div
            className="px-2 py-1 rounded-lg text-[10px] font-mono"
            style={{
              background: 'hsl(var(--surface))',
              border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--fg-subtle))',
            }}
          >
            tokens {tokenUsage.total_estimated_tokens}/{tokenUsage.budget_tokens}
            {' '}· schema {tokenUsage.schema_tokens}
            {' '}· prompt {tokenUsage.prompt_tokens}
            {' '}· sql {tokenUsage.sql_tokens}
          </div>
        )}

        {/* Chart created indicator */}
        {msg.chartId && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px]"
            style={{
              background: 'hsl(var(--success-bg))',
              color: 'hsl(var(--success))',
              border: '1px solid hsl(var(--success) / 0.2)',
            }}>
            <BarChart2 size={9} /> Chart added to canvas
          </div>
        )}

        {/* SQL toggle */}
        {sqlCode && (
          <div>
            <button
              onClick={() => setExpandSql(sqlExpanded ? null : msg.id)}
              className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg transition-colors"
              style={{
                background: sqlExpanded ? 'hsl(var(--primary-muted))' : 'hsl(var(--surface-raised))',
                color: sqlExpanded ? 'hsl(var(--primary))' : 'hsl(var(--fg-subtle))',
                border: '1px solid hsl(var(--border))',
              }}>
              <Code size={9} />
              {sqlExpanded ? 'Hide SQL' : 'View SQL'}
              <Table2 size={9} />
            </button>
            {sqlExpanded && (
              <div className="mt-1.5 p-2 rounded-lg overflow-auto anim-fade-up"
                style={{
                  background: 'hsl(0 0% 5%)',
                  border: '1px solid hsl(var(--border))',
                  maxHeight: 200,
                  fontSize: 10,
                  fontFamily: 'monospace',
                  color: '#a5d6ff',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}>
                {sqlCode}
              </div>
            )}
          </div>
        )}

        {/* Suggestion chips */}
        {suggestions.length > 0 && (
          <div className="flex flex-col gap-1 mt-0.5">
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => !loading && onSuggestionClick(s)}
                disabled={loading}
                className="text-left text-[10px] px-2.5 py-1.5 rounded-lg transition-all"
                style={{
                  background: 'hsl(var(--surface))',
                  border: '1px dashed hsl(var(--primary) / 0.35)',
                  color: 'hsl(var(--primary))',
                  opacity: loading ? 0.5 : 1,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={e => {
                  if (!loading) {
                    (e.currentTarget as HTMLElement).style.background = 'hsl(var(--primary-light))';
                    (e.currentTarget as HTMLElement).style.borderStyle = 'solid';
                  }
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = 'hsl(var(--surface))';
                  (e.currentTarget as HTMLElement).style.borderStyle = 'dashed';
                }}>
                ↳ {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Mock chart builder ───────────────────────────────────────── */
function buildMockChart(
  content: string, tabId: string, dashboardId: string, order: number,
): ChartData {
  const lower = content.toLowerCase();
  let type: ChartType = 'bar';
  if (lower.includes('trend') || lower.includes('month') || lower.includes('over time')) type = 'line';
  else if (lower.includes('pie') || lower.includes('distribution') || lower.includes('share')) type = 'pie';
  else if (lower.includes('area')) type = 'area';
  else if (lower.includes('table') || lower.includes('list')) type = 'table';

  const items  = ['Laptop', 'Mouse', 'Keyboard', 'Monitor', 'Headset', 'Phone', 'Tablet'];
  const data   = items.slice(0, 6).map(name => ({
    name, value: Math.floor(Math.random() * 50000) + 5000,
  }));

  return {
    id: `chart-${Date.now()}`, title: content.slice(0, 48),
    type, data, columns: ['name', 'value'], xKey: 'name', yKey: 'value',
    order, tabId, dashboardId, createdAt: new Date().toISOString(),
    query: '',
  };
}
