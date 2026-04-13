import { useState } from 'react';
import {
  MoreHorizontal, Trash2, BarChart2, LineChart, PieChart,
  AreaChart, Table2, TrendingUp, GripVertical, RefreshCw,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ChartType, ChartData } from '../../store/useAppStore';
import { useAppStore } from '../../store/useAppStore';
import ReactECharts from 'echarts-for-react';

const CHART_TYPES: { value: ChartType; label: string; icon: typeof BarChart2 }[] = [
  { value: 'bar',     label: 'Bar',     icon: BarChart2  },
  { value: 'line',    label: 'Line',    icon: LineChart  },
  { value: 'area',    label: 'Area',    icon: AreaChart  },
  { value: 'pie',     label: 'Pie',     icon: PieChart   },
  { value: 'scatter', label: 'Scatter', icon: TrendingUp },
  { value: 'table',   label: 'Table',   icon: Table2     },
];

function buildOption(chart: ChartData, isDark: boolean) {
  const palette = isDark
    ? ['#3b82f6','#22c55e','#f59e0b','#a78bfa','#f43f5e','#06b6d4','#fb923c']
    : ['#2563eb','#16a34a','#d97706','#7c3aed','#e11d48','#0891b2','#ea580c'];

  const textColor    = isDark ? '#9ca3af' : '#6b7280';
  const gridColor    = isDark ? '#1f1f1f' : '#f1f5f9';
  const tooltipBg    = isDark ? '#1c1c1c' : '#ffffff';
  const tooltipBorder = isDark ? '#2a2a2a' : '#e2e8f0';

  const baseTooltip = {
    trigger: 'axis' as const,
    backgroundColor: tooltipBg,
    borderColor: tooltipBorder,
    borderWidth: 1,
    textStyle: { color: isDark ? '#e5e7eb' : '#374151', fontSize: 12 },
    axisPointer: { lineStyle: { color: isDark ? '#333' : '#cbd5e1' } },
  };

  const baseAxis = {
    axisLine:  { lineStyle: { color: gridColor } },
    splitLine: { lineStyle: { color: gridColor } },
    axisLabel: { color: textColor, fontSize: 11 },
    axisTick:  { show: false },
  };

  const rows  = chart.data ?? [];
  const xKey  = chart.xKey ?? (rows[0] ? Object.keys(rows[0])[0] : 'x');
  const yKey  = chart.yKey ?? (rows[0] ? Object.keys(rows[0])[1] : 'y');
  const xData = rows.map((r) => String(r[xKey] ?? ''));
  const yData = rows.map((r) => Number(r[yKey] ?? 0));

  /* Scatter needs two numeric axes — find numeric columns (values parse as number) */
  const numericKeys = rows[0]
    ? (Object.keys(rows[0]).filter((k) => {
        const v = rows[0][k];
        if (v == null || v === '') return false;
        const n = Number(v);
        return !Number.isNaN(n);
      }) as string[])
    : [];
  const scatterXKey = numericKeys[0] ?? xKey;
  const scatterYKey = numericKeys.length >= 2 ? numericKeys[1] : (numericKeys[0] ?? yKey);

  if (chart.type === 'bar') {
    return {
      color: palette,
      tooltip: baseTooltip,
      grid: { top: 20, right: 20, bottom: 30, left: 50, containLabel: true },
      xAxis: { type: 'category', data: xData, ...baseAxis },
      yAxis: { type: 'value', ...baseAxis },
      series: [{ type: 'bar', data: yData, barMaxWidth: 48,
        itemStyle: { color: palette[0], borderRadius: [4, 4, 0, 0] } }],
    };
  }

  if (chart.type === 'line') {
    return {
      color: palette,
      tooltip: baseTooltip,
      grid: { top: 20, right: 20, bottom: 30, left: 50, containLabel: true },
      xAxis: { type: 'category', data: xData, ...baseAxis },
      yAxis: { type: 'value', ...baseAxis },
      series: [{ type: 'line', data: yData, smooth: true,
        symbol: 'circle', symbolSize: 6,
        lineStyle: { width: 2, color: palette[0] },
        itemStyle: { color: palette[0] } }],
    };
  }

  if (chart.type === 'area') {
    return {
      color: palette,
      tooltip: baseTooltip,
      grid: { top: 20, right: 20, bottom: 30, left: 50, containLabel: true },
      xAxis: { type: 'category', data: xData, ...baseAxis },
      yAxis: { type: 'value', ...baseAxis },
      series: [{ type: 'line', data: yData, smooth: true,
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: isDark ? 'rgba(59,130,246,0.25)' : 'rgba(37,99,235,0.18)' },
            { offset: 1, color: 'rgba(59,130,246,0)' },
          ],
        }},
        lineStyle: { width: 2, color: palette[0] },
        itemStyle: { color: palette[0] } }],
    };
  }

  if (chart.type === 'pie') {
    return {
      color: palette,
      tooltip: { ...baseTooltip, trigger: 'item' },
      legend: { bottom: 4, textStyle: { color: textColor, fontSize: 11 } },
      series: [{
        type: 'pie', radius: ['38%', '68%'], center: ['50%', '46%'],
        data: rows.map((r, i) => ({ name: String(r[xKey] ?? i), value: Number(r[yKey] ?? 0) })),
        label: { show: false }, labelLine: { show: false },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.3)' } },
      }],
    };
  }

  if (chart.type === 'scatter') {
    const hasTwoNumerics = numericKeys.length >= 2;
    const scatterData = hasTwoNumerics
      ? rows.map((r) => [Number(r[scatterXKey] ?? 0), Number(r[scatterYKey] ?? 0)])
      : rows.map((r, i) => [i, Number(r[scatterYKey] ?? r[yKey] ?? 0)]);
    return {
      color: palette,
      tooltip: { ...baseTooltip, trigger: 'item' },
      grid: { top: 20, right: 20, bottom: 30, left: 50, containLabel: true },
      xAxis: { type: 'value', name: hasTwoNumerics ? scatterXKey : 'Index', ...baseAxis },
      yAxis: { type: 'value', name: hasTwoNumerics ? scatterYKey : (scatterYKey || yKey), ...baseAxis },
      series: [{ type: 'scatter', data: scatterData, symbolSize: 8, itemStyle: { color: palette[0] } }],
    };
  }

  return {};
}

interface Props {
  chart: ChartData;
  isDark: boolean;
}

export function ChartCard({ chart, isDark }: Props) {
  const { updateChart, removeChart } = useAppStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: chart.id });

  const span = chart.gridSpan ?? 1;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity:    isDragging ? 0.35 : 1,
    zIndex:     isDragging ? 999 : undefined,
    gridColumn: `span ${span}`,
  };

  const isTable = chart.type === 'table';
  const rows    = chart.data ?? [];
  const cols    = chart.columns ?? (rows[0] ? Object.keys(rows[0]) : []);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card chart-cell flex flex-col ${isDragging ? 'dnd-item-dragging' : ''}`}
    >
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0"
        style={{ borderBottom: '1px solid hsl(var(--border))' }}>

        {/* Drag handle */}
        <div {...attributes} {...listeners}
          className="cursor-grab active:cursor-grabbing p-0.5 rounded flex-shrink-0"
          style={{ color: 'hsl(var(--fg-subtle))', touchAction: 'none' }}
          title="Drag to reorder">
          <GripVertical size={14} />
        </div>

        <span className="flex-1 text-xs font-semibold truncate min-w-0"
          style={{ color: 'hsl(var(--fg))' }}>
          {chart.title}
        </span>

        {/* Per-chart column span */}
        <div className="flex items-center flex-shrink-0 rounded-md overflow-hidden"
          style={{ border: '1px solid hsl(var(--border))' }}>
          {([1, 2, 3] as const).map((v) => (
            <button
              key={v}
              title={`${v} column${v > 1 ? 's' : ''} wide`}
              onClick={() => updateChart(chart.id, { gridSpan: v })}
              className="flex items-center justify-center transition-all"
              style={{
                width: 22, height: 22,
                fontSize: 10, fontWeight: 700,
                background: span === v ? 'hsl(var(--primary))' : 'transparent',
                color:      span === v ? 'white' : 'hsl(var(--fg-subtle))',
                borderRight: v !== 3 ? '1px solid hsl(var(--border))' : 'none',
              }}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-3.5 flex-shrink-0" style={{ background: 'hsl(var(--border))' }} />

        {/* Chart type switcher */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {CHART_TYPES.map(({ value, icon: Icon, label }) => (
            <button key={value} title={label}
              onClick={() => updateChart(chart.id, { type: value })}
              className="p-1 rounded transition-colors"
              style={{
                color:      chart.type === value ? 'hsl(var(--primary))' : 'hsl(var(--fg-subtle))',
                background: chart.type === value ? 'hsl(var(--primary-muted))' : 'transparent',
              }}>
              <Icon size={12} />
            </button>
          ))}
        </div>

        {/* More menu */}
        <div className="relative flex-shrink-0">
          <button onClick={() => setMenuOpen((v) => !v)}
            className="p-1 rounded transition-colors"
            style={{ color: 'hsl(var(--fg-subtle))' }}>
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-7 z-50 rounded-xl overflow-hidden anim-scale-in"
              style={{
                background: 'hsl(var(--surface-raised))',
                border: '1px solid hsl(var(--border))',
                minWidth: 140,
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              }}>
              <button
                className="flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors"
                style={{ color: 'hsl(var(--fg-muted))' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'hsl(var(--surface))')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <RefreshCw size={11} /> Refresh
              </button>
              <button
                className="flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors"
                style={{ color: 'hsl(var(--danger))' }}
                onClick={() => { removeChart(chart.id); setMenuOpen(false); }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'hsl(var(--danger-bg))')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <Trash2 size={11} /> Delete Chart
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Chart body */}
      <div className="flex-1 overflow-hidden p-1" style={{ minHeight: 0 }}>
        {isTable ? (
          <div className="h-full overflow-auto p-1">
            {rows.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs"
                style={{ color: 'hsl(var(--fg-subtle))' }}>No data</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {cols.map((col) => (
                      <th key={col} style={{
                        padding: '6px 10px', textAlign: 'left', fontWeight: 600,
                        fontSize: 11, color: 'hsl(var(--fg-muted))',
                        borderBottom: '1px solid hsl(var(--border))', whiteSpace: 'nowrap',
                      }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((row, i) => (
                    <tr key={i}
                      style={{ background: i % 2 === 0 ? 'transparent' : 'hsl(var(--surface-raised))' }}>
                      {cols.map((col) => (
                        <td key={col} style={{
                          padding: '5px 10px', fontSize: 12,
                          color: 'hsl(var(--fg))',
                          borderBottom: '1px solid hsl(var(--border))',
                          whiteSpace: 'nowrap',
                        }}>{String(row[col] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <ReactECharts
            option={buildOption(chart, isDark)}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            theme={isDark ? 'dark' : undefined}
            notMerge
          />
        )}
      </div>
    </div>
  );
}
