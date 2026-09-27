const DEFAULT_SAMPLE_LIMIT = 512;
const DEFAULT_P50_TARGET_MS = 500;
const DEFAULT_P95_TARGET_MS = 1500;

type LatencySeries = {
  samples: number[];
  total: number;
  slow: number;
};

const overall: LatencySeries = { samples: [], total: 0, slow: 0 };
const byTool = new Map<string, LatencySeries>();

function boundedNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function sampleLimit(): number {
  return Math.trunc(
    boundedNumber(
      process.env.MCP_LATENCY_SAMPLE_LIMIT,
      DEFAULT_SAMPLE_LIMIT,
      32,
      10_000,
    ),
  );
}

export function performanceTargets() {
  return {
    warmLocalPrimitiveP50Ms: boundedNumber(
      process.env.MCP_WARM_P50_TARGET_MS,
      DEFAULT_P50_TARGET_MS,
      10,
      10_000,
    ),
    warmLocalPrimitiveP95Ms: boundedNumber(
      process.env.MCP_WARM_P95_TARGET_MS,
      DEFAULT_P95_TARGET_MS,
      25,
      30_000,
    ),
  };
}

function push(series: LatencySeries, durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const value = Math.round(durationMs * 1000) / 1000;
  series.samples.push(value);
  series.total += 1;
  if (value > performanceTargets().warmLocalPrimitiveP95Ms) {
    series.slow += 1;
  }

  const limit = sampleLimit();
  if (series.samples.length > limit) {
    series.samples.splice(0, series.samples.length - limit);
  }
}

export function recordMcpToolLatency(tool: string, durationMs: number) {
  const normalized = tool.trim() || "<unknown>";
  push(overall, durationMs);
  const series =
    byTool.get(normalized) ?? { samples: [], total: 0, slow: 0 };
  push(series, durationMs);
  byTool.set(normalized, series);
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index] ?? null;
}

function summarize(series: LatencySeries) {
  const targets = performanceTargets();
  const p50Ms = percentile(series.samples, 0.5);
  const p95Ms = percentile(series.samples, 0.95);
  const maxMs =
    series.samples.length > 0 ? Math.max(...series.samples) : null;

  return {
    retainedSamples: series.samples.length,
    totalSamples: series.total,
    p50Ms,
    p95Ms,
    maxMs,
    slowSamples: series.slow,
    meetsWarmTargets:
      p50Ms == null ||
      p95Ms == null ||
      (p50Ms <= targets.warmLocalPrimitiveP50Ms &&
        p95Ms <= targets.warmLocalPrimitiveP95Ms),
  };
}

export function mcpPerformanceSnapshot() {
  const targets = performanceTargets();
  const tools = [...byTool.entries()]
    .map(([tool, series]) => ({ tool, ...summarize(series) }))
    .sort((a, b) => b.totalSamples - a.totalSamples);

  return {
    scope:
      "server-received tools/call latency; excludes ChatGPT/gateway/network time before request arrival",
    targets,
    overall: summarize(overall),
    byTool: tools,
  };
}

export function resetMcpPerformanceMetricsForTests() {
  overall.samples.length = 0;
  overall.total = 0;
  overall.slow = 0;
  byTool.clear();
}
