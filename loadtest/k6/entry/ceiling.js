// Finds the arrival rate at which the app stops keeping up.
//
// ramping-arrival-rate, NOT ramping-vus. Under a closed model (ramping-vus)
// slow responses reduce the request rate, which masks saturation and draws a
// smooth curve over the cliff. An open model keeps issuing requests regardless
// of how long they take, so queueing surfaces as latency where it belongs.
import { consultantJourney } from '../scenarios/journey.js';

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
      // Enough VUs that k6 itself is never the constraint; the app caps at 8
      // concurrent, so anything past that queues on the server, not here.
      preAllocatedVUs: 100,
      maxVUs: 400,
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
