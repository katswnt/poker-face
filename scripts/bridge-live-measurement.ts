function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function record(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), "Invalid measurement object.");
  return value as Record<string, unknown>;
}
function nonnegative(value: unknown, name: string): number {
  requireValue(typeof value === "number" && Number.isFinite(value) && value >= 0, `Invalid ${name}.`);
  return value;
}

/** Sum RSS (KiB from ps) for a browser root and its descendants, not our test controller.
 * This can double-count shared pages and misses unsampled/reparented processes. Not PSS. */
export function browserTreeRssBytes(snapshot: string, rootPid: number, companionPids: readonly number[] = []): number {
  requireValue(Number.isSafeInteger(rootPid) && rootPid > 0, "Invalid browser PID.");
  const rows = new Map<number, { parent: number; bytes: number }>();
  for (const line of snapshot.trim().split(/\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    requireValue(match, "Invalid ps memory sample.");
    const [, pidText, parentText, rssText] = match;
    const pid = Number(pidText), parent = Number(parentText), bytes = Number(rssText) * 1024;
    requireValue(Number.isSafeInteger(pid) && pid > 0 && Number.isSafeInteger(parent)
      && Number.isSafeInteger(bytes) && !rows.has(pid), "Invalid/duplicate process memory row.");
    rows.set(pid, { parent, bytes });
  }
  requireValue(rows.has(rootPid), "Browser root missing from memory sample.");
  requireValue(companionPids.every(pid => rows.has(pid)), "Companion missing from memory sample.");
  const included = new Set([rootPid, ...companionPids]); let previous = 0;
  while (previous !== included.size) {
    previous = included.size;
    for (const [pid, row] of rows) if (included.has(row.parent)) included.add(pid);
  }
  return [...included].reduce((sum, pid) => sum + rows.get(pid)!.bytes, 0);
}

/** macOS reparents WebKit XPC services to launchd. Include newly started processes from
 * this exact browser bundle, excluding pre-existing PIDs and similarly named bundles. */
export function scopedBrowserRss(snapshot: string, rootPid: number,
  scope: { directory: string; preexistingPids: readonly number[] }) {
  const rows = snapshot.trim().split(/\n/).map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    requireValue(match, "Invalid process-command memory sample.");
    return { pid: Number(match[1]), parent: Number(match[2]), rss: match[3], command: match[4] };
  });
  const descendants = new Set([rootPid]); let previous = 0;
  while (previous !== descendants.size) {
    previous = descendants.size;
    for (const row of rows) if (descendants.has(row.parent)) descendants.add(row.pid);
  }
  const prior = new Set(scope.preexistingPids), prefix = scope.directory.replace(/\/$/, "") + "/";
  const companions = rows.filter(row => !descendants.has(row.pid) && !prior.has(row.pid) && row.command.startsWith(prefix));
  return { rssBytes: browserTreeRssBytes(rows.map(r => `${r.pid} ${r.parent} ${r.rss}`).join("\n"), rootPid, companions.map(r => r.pid)),
    companionProcesses: companions.length };
}

/** Measurement-only telemetry; the production protocol and solver are unchanged. */
export function summarizeMeasuredJob(events: readonly unknown[], terminalElapsedMs: number) {
  nonnegative(terminalElapsedMs, "elapsed time");
  const rows = events.map(record), estimates = rows.filter(e => e.type === "estimate");
  requireValue(estimates.length === 1, "Expected exactly one estimate.");
  requireValue(!rows.some(e => e.type === "error" || e.type === "cancelled"), "Job failed or cancelled.");
  const verdict = record(estimates[0].verdict);
  requireValue(typeof verdict.ok === "boolean", "Invalid admission verdict.");
  const observations = rows.flatMap(e => e.observedLinearMemoryBytes == null ? []
    : [nonnegative(e.observedLinearMemoryBytes, "linear memory")]);
  const peakLinearMemoryBytes = Math.max(0, ...observations);
  requireValue(peakLinearMemoryBytes > 0, "Missing linear memory observation.");
  const results = rows.filter(e => e.type === "result");
  requireValue(results.length === (verdict.ok ? 1 : 0), "Missing/unexpected result.");
  requireValue(rows.at(-1)?.type === (verdict.ok ? "result" : "estimate"), "Unexpected terminal event.");
  const result = verdict.ok ? record(results[0].result) : null;
  return { admitted: verdict.ok, terminalElapsedMs, peakLinearMemoryBytes,
    reservedTotalBytes: nonnegative(verdict.totalBytes, "reservation"), budgetBytes: nonnegative(verdict.budgetBytes, "budget"),
    iterations: result ? nonnegative(result.iterations, "iterations") : null,
    exploitabilityChips: result ? nonnegative(record(result.exploitability).chips, "exploitability") : null,
    exportedNodes: result ? nonnegative(record(result.counts).exportedNodes, "node count") : null };
}
