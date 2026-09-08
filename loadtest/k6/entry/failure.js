// Walks the fake 1C through each failure mode under steady scan load, then
// runs a login storm. Each mode gets its own window so the metrics separate.
//
// RULING R7 — every scenario's startTime is DERIVED from FAILURE_WINDOW
// (via lib/duration.js — the same parser ceiling.js's opt-in ingest scenario
// uses, rather than a third private copy of sweep.js's own version), never
// hard-coded, so a short verification window genuinely shortens the whole
// run instead of leaving dead air between windows.
import { setFakeMode, scanUnderMode, loginStorm } from '../scenarios/failure-modes.js';
import { parseDurationMs, msToDuration } from '../lib/duration.js';
import { trustVerdict } from '../lib/trust.js';

const WINDOW = __ENV.FAILURE_WINDOW || '30s';
const WINDOW_MS = parseDurationMs(WINDOW);
// NOT sweep.js's 5s GAP_MS — confirmed by running it: 5s is nowhere near
// enough here. hang_30s's iterations that arrive right at the END of its
// own window each still take ~15-16s (the client's read timeout) to
// complete AFTER that window has nominally closed. With only a 5s gap, the
// NEXT scenario's traffic starts while those stragglers are still holding
// real Gunicorn slots on the shared backend — contaminating the next
// window's numbers with leftover hang_30s queueing rather than measuring
// that window's own mode in isolation, and (confirmed by a live run) also
// pushing some of hang_30s's OWN arrivals past its Little's-Law VU sizing
// as the extra contention inflates iteration duration beyond the ~16s the
// sizing in the comment above `SCENARIOS` assumed, which showed up as
// dropped_iterations even with peak VUs comfortably under the cap. 20s
// covers hang_30s's worst observed tail (max=16091ms in that run) with a
// real margin, for every gap, not just the one after hang.
const GAP_MS = 20000;

function startTimeAt(index) {
  return msToDuration(index * (WINDOW_MS + GAP_MS));
}

function window(exec, index, rate, preAllocatedVUs, maxVUs, timeUnit = '1s') {
  return {
    executor: 'constant-arrival-rate',
    rate,
    timeUnit,
    duration: WINDOW,
    preAllocatedVUs,
    maxVUs,
    exec,
    startTime: startTimeAt(index),
  };
}

// Rate sizing here is NOT just Little's Law VU-pool math (concurrently-held
// VUs ~= rate x mean iteration duration) — confirmed by running it. The
// backend genuinely has ~8 concurrent execution slots (basic-xxs,
// `--workers 2 --threads 4`, per CLAUDE.md), and slow_5s/hang_30s each hold
// ONE of those slots for the full duration of their blocking upstream call
// (5s / ~15s respectively — httpx.request() blocks the Gunicorn thread
// synchronously). That caps this app's SUSTAINABLE throughput for those two
// modes at roughly 8-slots / mean-duration, independent of how many VUs k6
// throws at it:
//   - slow_5s:  ~8 / 5.3s  ~= 1.5 req/s sustainable
//   - hang_30s: ~8 / 15.5s ~= 0.5 req/s sustainable
// A rate ABOVE that ceiling doesn't just need more VUs to hold the extra
// in-flight iterations — it queues UNBOUNDED, because arrivals keep
// outpacing what the backend can drain. Confirmed empirically: at the
// brief's original rate=5/s for hang_30s, the queue grew for the ENTIRE
// 12s window and the backlog was still draining well into the NEXT
// scenario's window minutes later (even with a 20s inter-window gap),
// producing dropped_iterations, "interrupted" iterations, and contaminated
// latency in later windows that had nothing to do with their own mode. That
// is itself a real, reportable finding in its own right (a hang_30s burst
// at a rate exceeding ~0.5 req/s will hold ALL 8 slots and queue everyone
// else, consultants included, until it drains) — see the task report for a
// deliberate, isolated demonstration of it. It is NOT what this committed
// suite measures by default, because an unbounded queue is exactly the kind
// of thing the dispatch's safety constraint warns against reproducing here.
//
// slow_5s and hang_30s below therefore run at a rate UNDER their own
// sustainable ceiling, so each window cleanly measures "does one request
// honor its own budget" without inducing a queue that outlives the window:
//   - slow_5s:  rate 1/s (< 1.5/s ceiling). ~5.5 VUs needed; 20 gives
//     ~4x headroom.
//   - hang_30s: rate 0.5/s (< 0.5/s ceiling, deliberately conservative
//     given how close that ceiling is to the target rate). ~8 VUs needed;
//     30 gives ~4x headroom — still the tightest-margin mode, so still the
//     one most worth erring generous on.
// http_500 / refuse have no such ceiling problem — both fail in well under
// a second, so even rate 5/s is nowhere near 8-slots-worth of concurrent
// holding.
//
// storm (login + refresh) is NOT sub-second under its own rate, contrary to
// a naive guess — confirmed by running it: PBKDF2 plus the refresh
// blacklist-row insert (see loginStorm's own comment) queue behind the same
// 8 slots too, so at rate 10/s the combined login+refresh duration averaged
// ~4.2s (p95 ~8.8s combined) once the storm was actually under way, not the
// <1s assumed when this was first sized at preAllocatedVUs:30 — which was
// too low and produced the same reactive-allocator-lag drops documented in
// the hang_30s discussion above. 80/150 gives real headroom over the
// observed ~42 VUs (mean-based) to ~90 VUs (p95-based) demand, while
// staying nowhere near the 1000+ VUs that wedged the backend in Task 6
// (that was a RAMPING scenario growing into the thousands within seconds;
// this is a flat, bounded rate with a capped pool — the dispatch's safety
// constraint is about that distinction, not about VU count in isolation).
const SCENARIOS = {
  slow: window('slow', 0, 1, 10, 20),
  // rate:1, timeUnit:'2s' (0.5 req/s) — k6's constant-arrival-rate wants an
  // integer rate, so this is expressed as "1 per 2 seconds" rather than a
  // fractional 0.5.
  hang: window('hang', 1, 1, 15, 30, '2s'),
  broken: window('broken', 2, 5, 10, 30),
  refused: window('refused', 3, 5, 10, 30),
  storm: window('storm', 4, 10, 80, 150),
};

// Largest single-scenario cap in the run — the reference point for the
// trustworthiness verdict below. Scenarios run in disjoint sequential
// windows (see startTimeAt), so the run-wide peak `vus` metric is really
// whichever scenario's own peak was highest, not a sum across scenarios;
// dropped_iterations is likewise a run-wide total, not broken out per mode.
const MAX_VUS = Math.max(...Object.values(SCENARIOS).map((s) => s.maxVUs));

export const options = {
  scenarios: SCENARIOS,
  thresholds: {
    // The whole point: a misbehaving upstream must not park a worker until
    // the router's 60s cutoff. Breaching this is the headline finding — do
    // NOT weaken it to force a green run; report the breach instead.
    upstream_failure_duration: ['p(99)<25000'],
    // Per-mode breakdown so the printed summary (not just --out csv=) shows
    // each mode's own latency — a plain Trend's per-tag numbers only appear
    // in the default summary when there's an explicit per-tag threshold on
    // them (see the Task 6/7 report). Same bound as the aggregate: each
    // mode must ALSO stay under budget on its own, not just blend
    // acceptably into the combined p99.
    'upstream_failure_duration{mode:slow_5s}': ['p(99)<25000'],
    'upstream_failure_duration{mode:hang_30s}': ['p(99)<25000'],
    'upstream_failure_duration{mode:http_500}': ['p(99)<25000'],
    'upstream_failure_duration{mode:refuse}': ['p(99)<25000'],
    // Login-storm cost, surfaced the same way (an explicit per-tag
    // threshold is also what makes these two show up in the printed summary
    // at all — a plain Trend's per-tag numbers are otherwise invisible
    // without --out csv=, per the Task 6/7 report). Generous but real
    // bounds, not throwaway: a shift-change burst genuinely should not push
    // an individual login past 5s or a refresh past 3s even while PBKDF2
    // and the blacklist-row insert queue behind the same 8 slots.
    'http_req_duration{endpoint:auth_login}': ['p(95)<5000'],
    'http_req_duration{endpoint:auth_refresh}': ['p(95)<3000'],
    // RULING R16 — every entry point declares this. scanUnderMode's two
    // budget/hang checks are bare check() calls that don't feed
    // endpoint_failures on their own; this fails the run on ANY failed
    // check(), current or future — see smoke.js's own comment for the full
    // rationale.
    checks: ['rate==1.00'],
  },
};

export function setup() {
  setFakeMode('fast');
}

export function teardown() {
  // A killed run leaves the fake stuck in whatever mode it was last set to,
  // silently poisoning every later test against this stack. teardown() only
  // runs on a CLEAN completion (k6 skips it on Ctrl-C / a killed process) —
  // reset by hand after an interrupted run:
  //   curl -s -X POST http://localhost:8099/_control \
  //     -H 'Content-Type: application/json' -d '{"mode":"fast"}'
  // (that's the host-mapped port from docker-compose.loadtest.yml's
  // "8099:8099"; from inside the compose network — e.g. another k6 run via
  // loadtest/scripts/k6.sh — the same call goes to
  // http://fake-1c:8099/_control instead.)
  setFakeMode('fast');
}

export function slow() {
  if (__ITER === 0) setFakeMode('slow_5s');
  scanUnderMode('slow_5s');
}

export function hang() {
  if (__ITER === 0) setFakeMode('hang_30s');
  scanUnderMode('hang_30s');
}

export function broken() {
  if (__ITER === 0) setFakeMode('http_500');
  scanUnderMode('http_500');
}

export function refused() {
  if (__ITER === 0) setFakeMode('refuse');
  scanUnderMode('refuse');
}

export function storm() {
  if (__ITER === 0) setFakeMode('fast');
  loginStorm();
}

// Same discipline as ceiling.js's own handleSummary (see lib/trust.js for
// why the verdict logic lives there instead of being reinvented here): a
// failure-mode run whose load was not actually delivered tells us nothing
// about whether the backend held its budget — it would just tell us k6
// couldn't drive the nominal rate.
export function handleSummary(data) {
  const verdict = trustVerdict(data, MAX_VUS);
  const lines = ['', ...verdict.lines, ''];

  lines.push(fmtRate('checks', data.metrics.checks));
  lines.push(fmtRate('endpoint_failures', data.metrics.endpoint_failures));
  lines.push(fmtRate('http_req_failed', data.metrics.http_req_failed));
  lines.push(`dropped_iterations....: ${verdict.dropped}`);
  lines.push('');
  lines.push('upstream_failure_duration by mode (ms) — the headline numbers:');
  lines.push(fmtDuration('  slow_5s  ', data.metrics['upstream_failure_duration{mode:slow_5s}']));
  lines.push(fmtDuration('  hang_30s ', data.metrics['upstream_failure_duration{mode:hang_30s}']));
  lines.push(fmtDuration('  http_500 ', data.metrics['upstream_failure_duration{mode:http_500}']));
  lines.push(fmtDuration('  refuse   ', data.metrics['upstream_failure_duration{mode:refuse}']));
  lines.push('');
  lines.push('login storm (auth_login / auth_refresh) latency — for server_query_count');
  lines.push('per endpoint, re-run with --out csv= (per-tag Trends need it; see the Task 6/7 report):');
  lines.push(fmtDuration('  auth_login ', data.metrics['http_req_duration{endpoint:auth_login}']));
  lines.push(fmtDuration('  auth_refresh', data.metrics['http_req_duration{endpoint:auth_refresh}']));
  lines.push('');
  lines.push('thresholds:');
  for (const [name, metric] of Object.entries(data.metrics)) {
    if (!metric.thresholds) continue;
    for (const [expr, result] of Object.entries(metric.thresholds)) {
      const ok = !!(result && result.ok);
      lines.push(`  ${ok ? 'ok       ' : 'BREACHED '} ${name} [${expr}]`);
    }
  }
  lines.push('');

  return { stdout: lines.join('\n') + '\n' };
}

function fmtRate(label, metric) {
  if (!metric || !metric.values || typeof metric.values.rate !== 'number') return `${label}...: n/a`;
  const { rate, passes, fails } = metric.values;
  return `${label}${'.'.repeat(Math.max(1, 22 - label.length))}: rate=${(rate * 100).toFixed(2)}% (${passes}/${passes + fails})`;
}

function fmtDuration(label, metric) {
  if (!metric || !metric.values) return `${label}: n/a`;
  const v = metric.values;
  const p99 = typeof v['p(99)'] === 'number' ? v['p(99)'].toFixed(0) : 'n/a';
  return `${label}: avg=${v.avg.toFixed(0)} med=${v.med.toFixed(0)} p90=${v['p(90)'].toFixed(0)} ` +
    `p95=${v['p(95)'].toFixed(0)} p99=${p99} max=${v.max.toFixed(0)}`;
}
