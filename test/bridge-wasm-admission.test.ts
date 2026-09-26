import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WASM_ADMISSION, WASM_PROFILE_BUDGETS, WASM_SPOT_CLASSES, admitLiveSpot, chooseThreading, exportBytesFromCounts,
  needsFreshWorker, parseBridgeEstimate, wasmBudget, type WasmDeviceProfile,
} from "../src/lib/solver/bridge/wasm-admission";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const F = WASM_ADMISSION.fixedOverheadBytes;
const PROFILES: readonly WasmDeviceProfile[] = ["desktop-chromium", "desktop-firefox", "desktop-safari", "mobile", "unknown"];
const est = (float32: number, compressed: number) => ({ estimatedBytes: float32, estimatedCompressedBytes: compressed });
const desktop = { profile: "desktop-chromium" } as const;

test("estimate parser mirrors the solver-bridge estimate line", () => {
  const line = JSON.stringify({
    type: "estimate", spotId: "smoke-upstream-basic", spotHash: "ab".repeat(32), estimatedBytes: 12_100_000,
    estimatedCompressedBytes: 6_400_000, hands: [167, 250], memoryCapBytes: 8 * GIB,
  });
  const parsed = parseBridgeEstimate(line);
  assert.equal(parsed.estimatedBytes, 12_100_000);
  assert.deepEqual(parsed.hands, [167, 250]);
  assert.equal(parsed.estimateExport, undefined);
  assert.deepEqual(parseBridgeEstimate({ ...JSON.parse(line), estimateExport: { cells: 10, nodes: 2 } }).estimateExport, { cells: 10, nodes: 2 });
  assert.throws(() => parseBridgeEstimate({ ...JSON.parse(line), type: "progress" }), /type/);
  assert.throws(() => parseBridgeEstimate({ ...JSON.parse(line), estimatedBytes: -1 }), /estimatedBytes/);
  assert.throws(() => parseBridgeEstimate({ ...JSON.parse(line), hands: [1] }), /hands/);
  assert.throws(() => parseBridgeEstimate({ ...JSON.parse(line), estimateExport: { cells: 1 } }), /estimateExport/);
});

test("budgets: desktop 3.5 GiB, Safari 2 GiB, mobile 512 MiB, unknown as strict as mobile, deviceMemory only lowers", () => {
  assert.equal(wasmBudget(desktop).bytes, 3.5 * GIB);
  assert.equal(wasmBudget({ profile: "desktop-firefox" }).bytes, 3.5 * GIB);
  assert.equal(wasmBudget({ profile: "desktop-safari" }).bytes, 2 * GIB);
  assert.equal(wasmBudget({ profile: "mobile" }).bytes, 512 * MIB);
  assert.equal(wasmBudget({ profile: "unknown" }).bytes, Math.min(...Object.values(WASM_PROFILE_BUDGETS).map((b) => b.bytes)));
  assert.equal(wasmBudget({ profile: "desktop-chromium", deviceMemoryGiB: 8 }).bytes, 2 * GIB);
  assert.equal(wasmBudget({ profile: "desktop-chromium", deviceMemoryGiB: 64 }).bytes, 2 * GIB, "capped at 8");
  assert.equal(wasmBudget({ profile: "desktop-chromium", deviceMemoryGiB: 4 }).bytes, 1 * GIB);
  assert.equal(wasmBudget({ profile: "mobile", deviceMemoryGiB: 8 }).bytes, 512 * MIB, "never raises");
  assert.equal(wasmBudget({ profile: "desktop-chromium", deviceMemoryGiB: Number.NaN }).bytes, 64 * MIB, "invalid → smallest");
  // An unrecognised profile string (bad caller data) falls back to the strict budget.
  assert.equal(wasmBudget({ profile: "tv" as WasmDeviceProfile }).bytes, 512 * MIB);
});

test("boundary: exactly at the budget admits, one byte over refuses", () => {
  const X = 10 * MIB;
  const B = 3.5 * GIB;
  const at = admitLiveSpot(est(B - X - F, B - X - F), desktop, { exportBytes: X });
  assert.equal(at.ok, true);
  assert.equal(at.ok && at.headroomBytes, 0);
  assert.equal(at.ok && at.precision, "float32");
  const over = admitLiveSpot(est(B - X - F + 1, B - X - F + 1), desktop, { exportBytes: X });
  assert.equal(over.ok, false);
  assert.equal(!over.ok && over.overBytes, 1);
  assert.match(over.reason, /Too large.*over the 3\.50 GiB budget.*Nothing was allocated/);
  // The export and the overhead count: the same storage with one more export byte is refused.
  assert.equal(admitLiveSpot(est(B - X - F, B - X - F), desktop, { exportBytes: X + 1 }).ok, false);
  assert.equal(admitLiveSpot(est(B - X - F, B - X - F), desktop, { exportBytes: X, fixedOverheadBytes: F + 1 }).ok, false);
});

test("precision: uncompressed if it fits, else compressed if it fits, else refuse", () => {
  const B = 512 * MIB;
  const mobile = { profile: "mobile" } as const;
  const fits = admitLiveSpot(est(100 * MIB, 50 * MIB), mobile, { exportBytes: 0 });
  assert.ok(fits.ok && fits.precision === "float32" && !fits.outsideTolerance);
  const compressed = admitLiveSpot(est(B - F + 1, B - F), mobile, { exportBytes: 0 });
  assert.ok(compressed.ok && compressed.precision === "int16-compressed" && compressed.outsideTolerance);
  assert.match(compressed.reason, /16-bit compression/);
  const neither = admitLiveSpot(est(B, B - F + 1), mobile, { exportBytes: 0 });
  assert.ok(!neither.ok);
  assert.equal(neither.overBytes, 1, "measured against the smaller (compressed) total");
  const noCompression = admitLiveSpot(est(B - F + 1, B - F), mobile, { exportBytes: 0, allowCompressed: false });
  assert.ok(!noCompression.ok);
  assert.match(noCompression.reason, /compression not allowed/);
});

test("export size: from estimate counts, explicit override, or refuse when unknown", () => {
  assert.equal(exportBytesFromCounts({ cells: 1000, nodes: 10 }), 2 * (12 * 1000 + 200 * 10));
  const counted = admitLiveSpot({ ...est(MIB, MIB), estimateExport: { cells: 1000, nodes: 10 } }, desktop);
  assert.ok(counted.ok);
  assert.equal(counted.numbers.exportBytes, 28_000);
  const overridden = admitLiveSpot({ ...est(MIB, MIB), estimateExport: { cells: 1000, nodes: 10 } }, desktop, { exportBytes: 5 });
  assert.ok(overridden.ok && overridden.numbers.exportBytes === 5);
  const unknown = admitLiveSpot(est(MIB, MIB), desktop);
  assert.ok(!unknown.ok && unknown.numbers === null);
  assert.match(unknown.reason, /export size is unknown/);
  assert.throws(() => admitLiveSpot(est(MIB, MIB), desktop, { exportBytes: -1 }), /exportBytes/);
  assert.throws(() => admitLiveSpot(est(Number.NaN, MIB), desktop, { exportBytes: 0 }), /estimatedBytes/);
});

test("the locked B1 benchmark (32.8 GB / 16.6 GB) and its all-in trim are refused on every profile", () => {
  for (const storage of [est(32.8e9, 16.6e9), est(21.2e9, 10.7e9)]) {
    for (const profile of PROFILES) {
      const verdict = admitLiveSpot(storage, { profile }, { exportBytes: 0 });
      assert.equal(verdict.ok, false, `${profile} ${storage.estimatedBytes}`);
      assert.match(verdict.reason, /Too large/);
    }
  }
});

test("the B3 lean benchmark fits desktop Chromium/Firefox only compressed, and nowhere else", () => {
  const b3 = est(5_995_858_864, 3_045_718_494);
  for (const profile of PROFILES) {
    const verdict = admitLiveSpot(b3, { profile }, { exportBytes: 0 });
    if (profile === "desktop-chromium" || profile === "desktop-firefox") {
      assert.ok(verdict.ok && verdict.precision === "int16-compressed" && verdict.outsideTolerance, profile);
    } else {
      assert.equal(verdict.ok, false, profile);
    }
    assert.equal(admitLiveSpot(b3, { profile }, { exportBytes: 0, allowCompressed: false }).ok, false, `${profile} float32-only`);
  }
  // A full flop export (hundreds of MB) would push it over; the export term matters.
  assert.equal(admitLiveSpot(b3, desktop, { exportBytes: 600e6 }).ok, false);
});

test("upstream basic example is admitted at full precision on every profile", () => {
  for (const profile of PROFILES) {
    const verdict = admitLiveSpot(est(12.1e6, 6.4e6), { profile }, { exportBytes: 64 * MIB });
    assert.ok(verdict.ok && verdict.precision === "float32", profile);
    assert.match(verdict.reason, /full precision/);
  }
});

test("mobile is stricter than desktop, and unknown is as strict as the strictest", () => {
  const flop3bet = est(1.25e9, 0.66e9);
  assert.ok(admitLiveSpot(flop3bet, desktop, { exportBytes: 0 }).ok);
  assert.equal(admitLiveSpot(flop3bet, { profile: "mobile" }, { exportBytes: 0 }).ok, false);
  assert.equal(admitLiveSpot(flop3bet, { profile: "unknown" }, { exportBytes: 0 }).ok, false);
  // Sweep: anything admitted on mobile or unknown is admitted on every desktop profile, never the reverse.
  for (let mib = 16; mib <= 4096; mib *= 2) {
    const storage = est(mib * MIB, (mib / 2) * MIB);
    const strict = ["mobile", "unknown"].map((profile) => admitLiveSpot(storage, { profile: profile as WasmDeviceProfile }, { exportBytes: 0 }).ok);
    const loose = ["desktop-chromium", "desktop-firefox", "desktop-safari"].map((profile) =>
      admitLiveSpot(storage, { profile: profile as WasmDeviceProfile }, { exportBytes: 0 }).ok);
    if (strict.some(Boolean)) assert.ok(loose.every(Boolean), `${mib} MiB`);
    assert.equal(strict[0], strict[1], `unknown matches mobile at ${mib} MiB`);
  }
});

test("spot-class table: every measured row's expected verdict matches the rule", () => {
  for (const row of WASM_SPOT_CLASSES) {
    if (row.float32Bytes === null || row.compressedBytes === null) {
      assert.deepEqual(row.expected, { desktop: null, mobile: null }, row.id);
      continue;
    }
    for (const [key, profile] of [["desktop", "desktop-chromium"], ["mobile", "mobile"]] as const) {
      const verdict = admitLiveSpot(est(row.float32Bytes, row.compressedBytes), { profile }, { exportBytes: 0 });
      assert.equal(verdict.ok ? verdict.precision : "refuse", row.expected[key], `${row.id} on ${key}`);
    }
  }
});

test("threading: MT only when isolated, SAB present, module ok and profile verified", () => {
  const base = { crossOriginIsolated: true, sharedArrayBuffer: true, hardwareConcurrency: 10, profile: "desktop-chromium" } as const;
  assert.deepEqual(chooseThreading(base).mode, "mt");
  assert.equal(chooseThreading(base).threads, 8, "capped at 8");
  assert.equal(chooseThreading({ ...base, hardwareConcurrency: 4 }).threads, 4);
  assert.equal(chooseThreading({ ...base, mtModuleInstantiated: true }).mode, "mt");
  for (const [override, pattern] of [
    [{ crossOriginIsolated: false }, /not cross-origin isolated/],
    [{ sharedArrayBuffer: false }, /SharedArrayBuffer/],
    [{ mtModuleInstantiated: false }, /failed to start/],
    [{ profile: "desktop-safari" }, /not yet verified/],
    [{ profile: "mobile" }, /not yet verified/],
    [{ profile: "unknown" }, /not yet verified/],
    [{ hardwareConcurrency: 1 }, /one hardware thread/],
    [{ hardwareConcurrency: undefined }, /one hardware thread/],
    [{ hardwareConcurrency: Number.NaN }, /one hardware thread/],
  ] as const) {
    const choice = chooseThreading({ ...base, ...override });
    assert.equal(choice.mode, "st", JSON.stringify(override));
    assert.equal(choice.threads, 1);
    assert.match(choice.reason, pattern);
  }
});

test("a solve over 256 MiB gets a fresh worker", () => {
  assert.equal(needsFreshWorker(256 * MIB), false);
  assert.equal(needsFreshWorker(256 * MIB + 1), true);
});
