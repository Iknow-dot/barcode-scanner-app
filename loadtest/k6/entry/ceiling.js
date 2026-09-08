// Finds the arrival rate at which the app stops keeping up.
//
// ramping-arrival-rate, NOT ramping-vus. Under a closed model (ramping-vus)
// slow responses reduce the request rate, which masks saturation and draws a
// smooth curve over the cliff. An open model keeps issuing requests regardless
// of how long they take, so queueing surfaces as latency where it belongs.
import { consultantJourney } from '../scenarios/journey.js';
import { pushCatalogPage } from '../scenarios/ingest.js';
import { parseDurationMs, msToDuration } from '../lib/duration.js';

// How many VUs an open-model executor needs to drive a given arrival rate
// honestly is NOT the arrival rate itself — it's Little's Law: concurrently
// -held VUs ≈ target arrival rate (req/s) × mean iteration duration (s).
// This app queues instead of shedding load once its ~8 concurrent Gunicorn
// slots are full (confirmed: p95 latency reaches 30-50s under heavy queueing
// in this stack, with http_req_failed staying 0.00% throughout — see the
// Task 6/7 report), so under saturation mean iteration duration can run into
// the tens of seconds. Sustaining even 100 req/s open-loop at a 20-30s mean
// iteration duration needs on the order of 2,000-3,000 concurrently-held
// VUs — nowhere near a naive guess. If maxVUs runs out mid-ramp,
// ramping-arrival-rate does NOT queue the excess arrival: it silently DROPS
// the iteration without ever sending a request (see dropped_iterations),
// which cheaply caps observed throughput at roughly
// maxVUs / mean-iteration-duration — a ceiling in the HARNESS, not the app,
// and indistinguishable from real app saturation in http_req_failed,
// http_req_duration or endpoint_failures alone. handleSummary below is what
// makes the difference visible: it compares peak vus against MAX_VUS and
// refuses to let a VU-starved run pass as a quiet, trustworthy result.
//
// Sized for the DEFAULT_STAGES ramp below (tops out at target 200): 200
// req/s × ~15s mean iteration under heavy queueing ≈ 3,000 VUs at the
// extreme, so 4000 leaves headroom. If the ramp target or this app's
// latency characteristics change materially, re-derive this number from
// Little's Law rather than assuming 4000 stays enough — that's exactly the
// mistake this comment exists to prevent repeating.
const MAX_VUS = 4000;

// CAUTION, confirmed by running it: pushing this ramp toward its documented
// target of 200 (or any target requiring hundreds-to-thousands of fresh
// VUs within a short window) collides with journey.js's one-login-per-VU
// design — EVERY brand-new VU's first action is a login() call, so a rapid
// VU-pool expansion becomes a login storm (many concurrent bcrypt checks
// queueing behind the same ~8 Gunicorn slots). Locally this pushed some
// login requests past k6's own 60s client-side timeout — a genuine
// http_req_failed, but one that measures the login storm colliding with
// VU-ramp mechanics, not steady-state read-path capacity — AND it left the
// shared backend pegged at ~100% CPU digesting the accepted-but-unfinished
// backlog for a couple of minutes after the k6 process itself was killed
// (already-accepted synchronous work keeps running server-side regardless
// of whether the client is still waiting), requiring a container restart
// to get a clean baseline again. journey.js's own comment already flags
// this as "the login storm is its own case in failure-modes.js" — treat a
// full run of this ramp's upper stages as exercising that combined failure
// mode, not a clean characterization of GET/POST read-path saturation by
// itself. See the Task 6/7 report addendum for the numbers.
const DEFAULT_STAGES = [
  { target: 5, duration: '30s' },
  { target: 20, duration: '1m' },
  { target: 50, duration: '1m' },
  { target: 100, duration: '1m' },
  { target: 200, duration: '1m' },
  { target: 0, duration: '30s' },
];

// CEILING_STAGES lets a caller substitute a short verification ramp without
// editing this file, e.g.:
//   -e CEILING_STAGES='[{"target":5,"duration":"5s"},{"target":40,"duration":"10s"},{"target":0,"duration":"5s"}]'
// k6's own `--stage` CLI flag only patches the top-level `options.stages`
// used by the default ramping-vus executor when no `scenarios` block is
// defined — it does nothing for a `stages` array nested inside a named
// scenario's ramping-arrival-rate config, which is what this file uses. This
// env var is the equivalent lever for that executor shape.
const stages = __ENV.CEILING_STAGES ? JSON.parse(__ENV.CEILING_STAGES) : DEFAULT_STAGES;

// Opt-in bulk catalog-ingest scenario colliding with the ramp above — the
// real production collision, since the ingest endpoint shares the same 8
// Gunicorn slots as every consultant request. Off by default (WITH_INGEST is
// unset) so the plain ceiling run is unchanged; enable with -e WITH_INGEST=1.
//
// RULING R7 — start/duration are DERIVED from `stages` (DEFAULT_STAGES or a
// caller's CEILING_STAGES override), never hard-coded: a short verification
// ramp must produce a short collision window too, not an ingest scenario
// that starts after the whole ramp is already over. Starts once the ramp is
// 20% through (so baseline load is already established) and runs for 60% of
// the ramp's total duration — reuses lib/duration.js's parser rather than
// reinventing entry/sweep.js's private copy of the same computation a third
// time (see that module's own comment).
const RAMP_TOTAL_MS = stages.reduce((sum, s) => sum + parseDurationMs(s.duration), 0);
const INGEST_START_MS = Math.round(RAMP_TOTAL_MS * 0.2);
const INGEST_DURATION_MS = Math.max(5000, Math.round(RAMP_TOTAL_MS * 0.6));

export const options = {
  scenarios: {
    ceiling: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      // k6 grows the VU pool from here up to maxVUs only as needed, so
      // keeping preAllocatedVUs modest while MAX_VUS is generous (see the
      // comment above) doesn't cost anything on a run that never needs it.
      preAllocatedVUs: 100,
      maxVUs: MAX_VUS,
      stages,
    },
    ...(__ENV.WITH_INGEST ? {
      ingest: {
        executor: 'constant-arrival-rate',
        rate: 1,
        timeUnit: '5s',
        duration: msToDuration(INGEST_DURATION_MS),
        startTime: msToDuration(INGEST_START_MS),
        preAllocatedVUs: 2,
        maxVUs: 4,
        exec: 'ingest',
      },
    } : {}),
  },
  thresholds: {
    // Annotations on the report, not a build gate — the run is expected to
    // breach these, and where it breaches is the answer. That includes
    // `checks` below: once the app saturates, expectStatus's checks start
    // failing right alongside endpoint_failures/http_req_duration, by
    // design — rising latency and falling success rate here is the
    // instrument working, not a bug.
    'http_req_duration{endpoint:product_search}': ['p(95)<1000'],
    'http_req_duration{endpoint:catalog_list}': ['p(95)<1000'],
    endpoint_failures: ['rate<0.01'],
    // RULING R16 — bare check() calls (there are none directly in
    // journey.js today, but consultantJourney is shared with Task 8's mixed
    // run, which may add some) don't feed endpoint_failures on their own.
    // This threshold fails the run on ANY failed check(), current or
    // future, without depending on every check being routed through
    // expectStatus by hand — see smoke.js's own comment on the same
    // threshold for the full rationale.
    checks: ['rate==1.00'],
  },
};

export default function () {
  consultantJourney(__ITER);
}

// Only scheduled when WITH_INGEST is set (see options.scenarios.ingest
// above). pushCatalogPage(__ITER) is per-VU — __ITER is each VU's OWN
// iteration counter, so if k6 spins up a second/third/fourth VU under
// contention (it can, up to maxVUs:4, independent of how lightly loaded
// this scenario is), each new VU's __ITER also starts at 0, meaning several
// VUs can push the SAME pageIndex (and therefore the same SKU range)
// concurrently rather than __ITER counting up as one steady global
// sequence. That is harmless here — the ingest endpoint upserts
// idempotently by (organization, sku), so a repeated page is a no-op, not a
// correctness bug — but it does mean pageIndex should not be read as a
// guaranteed sweep through increasing SKU ranges; it stays well inside a
// realistic range for PRODUCT_COUNT=5000 / PAGE_SIZE=200 (25 pages)
// regardless, for any run short enough to be run against a shared backend.
export function ingest() {
  pushCatalogPage(__ITER);
}

// Distinguishes "the app saturated" from "k6 could not drive the nominal
// arrival rate" — see the MAX_VUS comment above for why nothing else in
// this run's numbers can tell those apart. Prints a loud, hard-to-miss
// warning for either of TWO distinct disqualifying conditions, and
// otherwise confirms explicitly that neither happened (so a report quoting
// this run's throughput can say so with evidence, not an assumption).
//
// The two conditions are checked independently, not as one combined
// "starved" flag: peak vus reaching MAX_VUS means the configured cap itself
// was the constraint (raise it). But k6's own docs are explicit that
// dropped_iterations can be non-zero even when peak vus stays comfortably
// under the cap — k6's reactive VU allocator does not always grow the pool
// fast enough as the app slows down, so arrivals get dropped at any
// allocation level, cap or no cap. A run with peak vus under the cap but
// dropped_iterations > 0 is JUST AS untrustworthy as one that hit the cap:
// in both cases the app never actually saw every intended arrival, so the
// nominal target rate was not what was delivered. Verified against this
// exact failure mode: a 60 req/s run had peak vus=255 (well under
// MAX_VUS=4000) yet dropped_iterations=157 — "under the cap" alone is not
// sufficient evidence of a clean run.
//
// Hand-rolled rather than built on the jslib.k6.io `textSummary` helper
// (which would reproduce k6's own colorized default report): that import is
// resolved over the network at script-load time, and this harness
// deliberately avoids a hard dependency on a public CDN being reachable
// wherever it runs — the same reasoning Task 5 applied when it reverted a
// similar public-URL workaround for the image-proxy check (see the Task 5
// report's Addendum 2). This digest is less pretty but selects the exact
// values this file's own thresholds care about, so nothing that matters is
// actually lost.
export function handleSummary(data) {
  const vus = data.metrics.vus;
  const peakVUs = vus && vus.values && typeof vus.values.max === 'number' ? vus.values.max : undefined;
  const cappedOut = peakVUs !== undefined && peakVUs >= MAX_VUS;
  const dropped = metricCount(data.metrics.dropped_iterations);
  const hadDrops = typeof dropped === 'number' && dropped > 0;

  const lines = [''];
  if (cappedOut) {
    lines.push('################################################################################');
    lines.push(`# WARNING: peak VUs (${peakVUs}) reached the configured maxVUs (${MAX_VUS}).`);
    lines.push('# ramping-arrival-rate does NOT queue once its VU pool is exhausted — it');
    lines.push('# silently DROPS iterations instead of ever sending the request. This run');
    lines.push("# measured the k6 HARNESS's VU ceiling, NOT the application's capacity.");
    lines.push('# DO NOT TRUST this run\'s throughput / http_req_failed / latency numbers as');
    lines.push('# an app-saturation finding. Raise MAX_VUS (see the Little\'s Law comment near');
    lines.push('# the top of this file) and re-run, or lower the ramp target to a rate this');
    lines.push('# box can actually deliver honestly.');
    lines.push('################################################################################');
  } else if (hadDrops) {
    lines.push('################################################################################');
    lines.push(`# WARNING: ${dropped} iterations were DROPPED even though peak VUs (${peakVUs})`);
    lines.push(`# stayed under the configured maxVUs (${MAX_VUS}). This is a DIFFERENT failure`);
    lines.push('# from hitting the VU cap: k6\'s reactive VU allocator could not spin up new VUs');
    lines.push('# fast enough once the app slowed down, so it dropped arrivals rather than ever');
    lines.push('# sending them. Either way, the DELIVERED rate was below the nominal ramp');
    lines.push('# target — DO NOT quote this run\'s nominal target as an achieved throughput or');
    lines.push('# capacity figure. The latency/query-count numbers below are still real');
    lines.push('# measurements of whatever traffic DID get through, but were measured at a');
    lines.push('# lower rate than intended.');
    lines.push('################################################################################');
  } else if (peakVUs !== undefined) {
    lines.push(
      `peak VUs used: ${peakVUs} / ${MAX_VUS} configured, 0 dropped iterations — this run's ` +
      "nominal target rate was actually delivered, so its throughput/latency reflect the " +
      'application, not the harness.',
    );
  } else {
    lines.push('NOTE: no vus metric found in this run\'s summary — could not verify whether ' +
      'it was VU-starved. Treat its throughput numbers with caution.');
  }
  lines.push('');

  lines.push(fmtRate('checks', data.metrics.checks));
  lines.push(fmtRate('endpoint_failures', data.metrics.endpoint_failures));
  lines.push(fmtRate('http_req_failed', data.metrics.http_req_failed));
  lines.push(`dropped_iterations....: ${metricCount(data.metrics.dropped_iterations)}`);
  lines.push(`iterations............: ${metricCount(data.metrics.iterations)}`);
  if (vus && vus.values) {
    lines.push(`vus...................: min=${vus.values.min} max=${vus.values.max}`);
  }
  lines.push('');
  lines.push('latency by endpoint (ms):');
  lines.push(fmtDuration('  product_search', data.metrics['http_req_duration{endpoint:product_search}']));
  lines.push(fmtDuration('  catalog_list', data.metrics['http_req_duration{endpoint:catalog_list}']));
  lines.push('');
  lines.push('thresholds:');
  for (const [name, metric] of Object.entries(data.metrics)) {
    if (!metric.thresholds) continue;
    for (const [expr, result] of Object.entries(metric.thresholds)) {
      const ok = !!(result && result.ok);
      // `name` is already the fully tag-filtered metric name (e.g.
      // "http_req_duration{endpoint:catalog_list}") when a threshold is
      // scoped to a tag — expr is just that metric's threshold expression on
      // its own, so join them with a space rather than nesting braces.
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
  return `${label}: avg=${v.avg.toFixed(0)} med=${v.med.toFixed(0)} p90=${v['p(90)'].toFixed(0)} ` +
    `p95=${v['p(95)'].toFixed(0)} max=${v.max.toFixed(0)}`;
}

function metricCount(metric) {
  if (!metric || !metric.values) return 0;
  return typeof metric.values.count === 'number' ? metric.values.count : JSON.stringify(metric.values);
}
