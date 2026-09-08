// Finds the arrival rate at which the app stops keeping up.
//
// ramping-arrival-rate, NOT ramping-vus. Under a closed model (ramping-vus)
// slow responses reduce the request rate, which masks saturation and draws a
// smooth curve over the cliff. An open model keeps issuing requests regardless
// of how long they take, so queueing surfaces as latency where it belongs.
import { consultantJourney } from '../scenarios/journey.js';

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

// Distinguishes "the app saturated" from "k6 ran out of VUs to send
// requests with" — see the MAX_VUS comment above for why nothing else in
// this run's numbers can tell the two apart. Prints a loud, hard-to-miss
// warning the moment peak concurrently-active VUs reaches the configured
// cap, and otherwise confirms explicitly that it didn't (so a report quoting
// this run's throughput can say so with evidence, not an assumption).
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
  const starved = peakVUs !== undefined && peakVUs >= MAX_VUS;

  const lines = [''];
  if (starved) {
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
  } else if (peakVUs !== undefined) {
    lines.push(
      `peak VUs used: ${peakVUs} / ${MAX_VUS} configured — stayed below the cap, so this ` +
      "run's throughput reflects the application, not the harness.",
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
