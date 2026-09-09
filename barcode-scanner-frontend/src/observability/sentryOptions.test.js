import * as Sentry from '@sentry/react';
import {buildSentryOptions, SENTRY_DATA_COLLECTION} from './sentryOptions';
import {scrubEvent} from './scrub';

// A syntactically valid DSN on Sentry's EU ingest host. Never resolved: no
// event is captured in these tests.
const DSN = 'https://examplePublicKey@o0.ingest.de.sentry.io/0';

/** True when a resolved category collects nothing. */
const collectsNothing = (value) => {
  if (value === false) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value !== null && typeof value === 'object') {
    return Object.values(value).every(collectsNothing);
  }
  return false;
};

describe('buildSentryOptions', () => {
  afterEach(() => {
    Sentry.getClient()?.close();
    Sentry.getGlobalScope().setClient(undefined);
  });

  const install = (env = {}) => {
    // defaultIntegrations off so this test installs no global handlers; the
    // resolution under test happens in the Client constructor either way.
    Sentry.init({
      ...buildSentryOptions({REACT_APP_SENTRY_DSN: DSN, ...env}),
      integrations: [],
      defaultIntegrations: false,
    });
    return Sentry.getClient();
  };

  it('resolves every data collection category to off', () => {
    // The tripwire. In @sentry/core's resolveDataCollectionOptions, supplying
    // *any* dataCollection object swaps the base from the deny-listed "PII
    // off" defaults to the fully permissive DEFAULTS, so a partial block is
    // more permissive than omitting the option entirely. Asserting on the
    // *resolved* options is the only way to see that.
    const resolved = install().getDataCollectionOptions();

    expect(resolved.userInfo).toBe(false);
    expect(resolved.cookies).toBe(false);
    expect(resolved.httpHeaders).toEqual({request: false, response: false});
    expect(resolved.httpBodies).toEqual([]);
    expect(resolved.urlQueryParams).toBe(false);
    expect(resolved.graphQL).toEqual({document: false, variables: false});
    expect(resolved.genAI).toEqual({inputs: false, outputs: false});
    expect(resolved.databaseQueryData).toBe(false);
    expect(resolved.stackFrameVariables).toBe(false);
  });

  it('leaves no resolved category collecting anything', () => {
    // Catches a category a future SDK adds that we have not enumerated —
    // which, given the DEFAULTS swap above, would arrive switched on.
    // frameContextLines is a count of source lines, not user data.
    const resolved = install().getDataCollectionOptions();
    const collecting = Object.entries(resolved)
      .filter(([key]) => key !== 'frameContextLines')
      .filter(([, value]) => !collectsNothing(value))
      .map(([key]) => key);

    expect(collecting).toEqual([]);
  });

  it('declares every category the resolver reads', () => {
    // The declaration, not just the resolution: an unwritten key silently
    // inherits the permissive DEFAULTS.
    const resolved = install().getDataCollectionOptions();
    const declared = Object.keys(SENTRY_DATA_COLLECTION);

    Object.keys(resolved)
      .filter((key) => key !== 'frameContextLines')
      .forEach((key) => expect(declared).toContain(key));
  });

  it('scrubs transactions as well as errors', () => {
    // beforeSend runs on error events alone; without its counterpart every
    // browser transaction bypasses scrubbing entirely.
    const options = buildSentryOptions({REACT_APP_SENTRY_DSN: DSN});

    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.beforeSendTransaction).toBe(scrubEvent);
  });

  it('reads its configuration from the environment', () => {
    const options = buildSentryOptions({
      REACT_APP_SENTRY_DSN: DSN,
      REACT_APP_SENTRY_ENVIRONMENT: 'staging',
      REACT_APP_SENTRY_RELEASE: 'abc123',
      REACT_APP_SENTRY_TRACES_SAMPLE_RATE: '0.25',
      REACT_APP_API_BASE_URL: 'https://api.example.com',
    });

    expect(options.dsn).toBe(DSN);
    expect(options.environment).toBe('staging');
    expect(options.release).toBe('abc123');
    expect(options.tracesSampleRate).toBe(0.25);
    // Trace headers never reach Photon or RS.ge.
    expect(options.tracePropagationTargets).toEqual(['https://api.example.com']);
  });
});
