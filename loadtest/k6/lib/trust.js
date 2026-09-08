// Shared "was this run's delivered load trustworthy" verdict.
//
// Mirrors the pattern ceiling.js's own handleSummary established (see that
// file's comment for the full derivation): a run is only trustworthy when
// peak VUs stayed under the configured cap AND no iterations were dropped.
// k6's reactive VU allocator can drop arrivals even when peak VUs never
// reaches the cap (confirmed in the Task 6/7 report — a 60 req/s ceiling run
// had peak vus=255 against a cap of 4000, comfortably under, yet
// dropped_iterations=157), so both conditions are checked independently, not
// folded into one flag.
//
// This does NOT literally reuse ceiling.js's handleSummary function — k6
// requires each entry point to define its own handleSummary export, so
// there is nothing there to import — but factors the verdict LOGIC into one
// place so failure.js (and any later entry point that needs the same
// discipline) doesn't reinvent or quietly diverge from it.
export function trustVerdict(data, maxVUs) {
  const vus = data.metrics.vus;
  const peakVUs = vus && vus.values && typeof vus.values.max === 'number' ? vus.values.max : undefined;
  const cappedOut = peakVUs !== undefined && maxVUs !== undefined && peakVUs >= maxVUs;

  const droppedMetric = data.metrics.dropped_iterations;
  const dropped = droppedMetric && droppedMetric.values && typeof droppedMetric.values.count === 'number'
    ? droppedMetric.values.count : 0;
  const hadDrops = dropped > 0;

  const lines = [];
  if (cappedOut) {
    lines.push('################################################################################');
    lines.push(`# WARNING: peak VUs (${peakVUs}) reached the configured cap (${maxVUs}).`);
    lines.push('# This run measured the k6 HARNESS\'s VU ceiling, not the behaviour under test.');
    lines.push('# DO NOT TRUST this run\'s numbers below. Raise the VU pool and re-run.');
    lines.push('################################################################################');
  } else if (hadDrops) {
    lines.push('################################################################################');
    lines.push(`# WARNING: ${dropped} iterations were DROPPED even though peak VUs (${peakVUs})`);
    lines.push(`# stayed under the cap (${maxVUs}). The nominal arrival rate was not fully`);
    lines.push('# delivered — do NOT quote this run\'s throughput/latency as a clean measurement');
    lines.push('# of behaviour AT the configured rate.');
    lines.push('################################################################################');
  } else if (peakVUs !== undefined) {
    lines.push(
      `peak VUs used: ${peakVUs} / ${maxVUs} configured, 0 dropped iterations — this run's ` +
      'load was actually delivered, so its numbers reflect the behaviour under test, not the harness.',
    );
  } else {
    lines.push('NOTE: no vus metric found in this run\'s summary — could not verify it was not VU-starved.');
  }

  return { trustworthy: !cappedOut && !hadDrops, peakVUs, dropped, lines };
}
