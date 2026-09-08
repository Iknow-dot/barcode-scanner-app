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
// own window each still take ~15-24s (the client's read timeout, plus
// whatever queueing has built up — see the SCENARIOS comment below) to
// complete AFTER that window has nominally closed. With only a 5s gap, the
// NEXT scenario's traffic starts while those stragglers are still holding
// real Gunicorn slots on the shared backend — contaminating the next
// window's numbers with leftover hang_30s queueing rather than measuring
// that window's own mode in isolation. 30s was chosen after running the
// suite at its own committed default (FAILURE_WINDOW=30s, this file's
// default) end to end: at 20s, a hang_30s straggler (p95=22605ms in that
// run) got forcibly INTERRUPTED by k6's own 30s gracefulStop before it
// could even finish, and the backlog was still detectably elevating
// http_500's own p95 (492ms vs a normal ~26ms) in the very next window.
// 30s gives real margin over every worst-case tail observed so far.
const GAP_MS = 30000;

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
// VUs ~= rate x mean iteration duration) — confirmed by running it, twice.
// The backend genuinely has ~8 concurrent execution slots (basic-xxs,
// `--workers 2 --threads 4`, per CLAUDE.md), and slow_5s/hang_30s each hold
// ONE of those slots for the full duration of their blocking upstream call
// (5s / ~15s respectively — httpx.request() blocks the Gunicorn thread
// synchronously). That caps this app's SUSTAINABLE throughput for those two
// modes at roughly 8-slots / mean-duration, independent of how many VUs k6
// throws at it — a NAIVE ceiling of ~1.5 req/s for slow_5s and ~0.5 req/s
// for hang_30s. A rate ABOVE that ceiling doesn't just need more VUs to
// hold the extra in-flight iterations — it queues UNBOUNDED, because
// arrivals keep outpacing what the backend can drain. Confirmed
// empirically: at the brief's original rate=5/s for hang_30s (10x this
// naive ceiling), the queue grew for the entire window and the backlog was
// still draining well over a minute later, into and past several
// subsequent windows — dropped_iterations, forcibly "interrupted"
// iterations, and contaminated latency in modes that had nothing to do
// with hang_30s. That is itself a real, reportable finding in its own
// right (a hang_30s burst at a rate exceeding its ceiling will hold ALL 8
// slots and queue everyone else, consultants included, until it drains) —
// see the task report. It is NOT what this suite measures by default,
// because an unbounded queue is exactly what the dispatch's safety
// constraint warns against reproducing here.
//
// The naive per-mode ceiling above is NOT the whole story either — running
// this file at its own committed FAILURE_WINDOW=30s default (not just the
// short verification windows used while first tuning these numbers)
// surfaced a SECOND, smaller effect: even a rate comfortably under the
// naive ceiling shows real, if bounded, drift over a full 30s window that
// a short 8-12s window doesn't run long enough to reveal. At the first
// "conservative" pass (slow_5s=1/s, hang_30s=0.5/s — each nominally 33-67%
// of its naive ceiling), a full-length run showed:
//   - slow_5s avg climbing from ~5.1s (short window) to ~7.0s (30s window)
//   - hang_30s avg/p95 climbing from ~15.3s/~16.2s to ~17.1s/~22.6s — close
//     enough to BUDGET_MS (25000ms) to be a real concern, and close enough
//     to hang_30s's own 30s gracefulStop that one straggler got forcibly
//     interrupted rather than allowed to finish
//   - dropped_iterations=43 despite peak VUs staying under the cap
// i.e. the naive "8 slots / duration" ceiling assumes perfect, lossless
// slot utilization; in practice there is enough per-request overhead
// (Django/DRF dispatch, the warehouse-scoping query, JWT auth, etc. on top
// of the raw upstream wait) that the REAL sustainable rate sits measurably
// below the naive number. slow_5s and hang_30s below run at HALF the
// already-conservative first pass to build in real margin against this,
// re-verified by running the full 30s-default suite again afterward (see
// the task report for the confirming numbers):
//   - slow_5s:  rate 0.5/s (~1/3 of the 1.5/s naive ceiling). ~5-6 VUs
//     needed even allowing for the observed drift; 20 gives real headroom.
//   - hang_30s: rate 0.25/s (~1/2 of the 0.5/s naive ceiling) — still the
//     tightest-margin mode, so still the one most worth erring generous
//     on. ~8-10 VUs needed even allowing for drift; 30 gives real headroom.
// http_500 / refuse have no such ceiling problem — both fail in well under
// a second, so even rate 5/s is nowhere near 8-slots-worth of concurrent
// holding, and neither showed meaningful drift at the 30s window once
// slow_5s/hang_30s stopped bleeding a backlog into their windows.
//
// storm (login + refresh) is NOT sub-second under its own rate, contrary to
// a naive guess — confirmed by running it: PBKDF2 plus the refresh
// blacklist-row insert (see loginStorm's own comment) queue behind the same
// 8 slots too. Its RATE (10/s) is deliberate and is not being tuned down
// here — measuring what a real shift-change burst costs is this
// scenario's entire purpose, and that cost showing up as elevated latency
// (see the two thresholds below, which ARE expected to breach) is the
// finding, not a defect to engineer away. Its VU POOL, however, needed
// raising twice for purely measurement-validity reasons (so the
// trustworthiness verdict isn't itself contaminated by VU starvation): the
// combined login+refresh duration under load averages several seconds, not
// the <1s a naive guess would assume, and at the full 30s default window
// peak VUs reached 133 against the previous 150 cap — too close for
// comfort. 100/220 gives real headroom over that, while staying nowhere
// near the 1000+ VUs that wedged the backend in Task 6 (that was a RAMPING
// scenario growing into the thousands within seconds; this is a flat,
// bounded rate with a capped pool — the dispatch's safety constraint is
// about that distinction, not about VU count in isolation).
const SCENARIOS = {
  // rate:1, timeUnit:'2s' (0.5 req/s) / hang's timeUnit:'4s' (0.25 req/s) —
  // k6's constant-arrival-rate wants an integer rate, so these are
  // expressed as "1 per N seconds" rather than a fractional rate.
  slow: window('slow', 0, 1, 10, 20, '2s'),
  hang: window('hang', 1, 1, 15, 30, '4s'),
  broken: window('broken', 2, 5, 10, 30),
  refused: window('refused', 3, 5, 10, 30),
  storm: window('storm', 4, 10, 100, 220),
};

// Largest single-scenario cap in the run — the reference point for the
// trustworthiness verdict below. Scenarios run in disjoint sequential
// windows (see startTimeAt), so the run-wide peak `vus` metric is really
// whichever scenario's own peak was highest, not a sum across scenarios;
// dropped_iterations is likewise a run-wide total, not broken out per mode.
//
// Confirmed by running the full FAILURE_WINDOW=30s default end to end (not
// just the short windows used while tuning SCENARIOS above): at the current
// rates, a WARNING from this verdict is expected to come from storm's own
// window, not from slow_5s/hang_30s bleeding through. storm's rate (10/s)
// deliberately exceeds its real sustained capacity — see storm's own
// comment above — so its window genuinely queues over a full 30s run
// (VUs climbing from ~7 to ~130+ before draining in gracefulStop, same
// shape hang_30s showed at its own too-high original rate). slow_5s and
// hang_30s were independently confirmed clean in that same run (near-zero
// variance: hang_30s avg=15036ms/p95=15038ms/max=15039ms, slow_5s
// avg=5024ms/p95=5028ms/max=5028ms — no queueing signature at all). So a
// WARNING here does not, by itself, cast doubt on the upstream_failure_duration
// numbers reported for slow_5s/hang_30s/http_500/refuse; check THOSE
// modes' own tight, low-variance distributions as the real trust signal
// for the headline budget assertion, rather than only the global verdict.
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
    //
    // THESE TWO ARE EXPECTED TO BREACH at the committed storm rate (10/s
    // combined login+refresh) — confirmed on every verification run, not a
    // one-off: auth_login p95 observed ~4.7-7.0s, auth_refresh p95 observed
    // ~3.8-6.5s. Same rule as upstream_failure_duration above: do NOT raise
    // these to force a green run. The breach itself IS the finding — a
    // shift-change burst measurably costs more than these bounds allow, and
    // that cost is what this scenario exists to surface. A future run that
    // exits 99 with THESE two red and upstream_failure_duration (and its
    // per-mode breakdown) green has reproduced this known result, not found
    // a new regression; a run where upstream_failure_duration itself turns
    // red is the one that means something changed.
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
