import {REDACTED, scrubEvent, scrubText, scrubValue, stripQuery} from './scrub';

describe('scrubText', () => {
  it('masks a Georgian personal id', () => {
    expect(scrubText('lookup failed for 01008012345'))
      .toBe(`lookup failed for ${REDACTED}`);
  });

  it('masks a Georgian entity id', () => {
    expect(scrubText('org id 405123456 missing'))
      .toBe(`org id ${REDACTED} missing`);
  });

  it('masks a Georgian phone', () => {
    expect(scrubText('called +995555123456')).toBe(`called ${REDACTED}`);
  });

  it('keeps an EAN-13 barcode', () => {
    expect(scrubText('scanned 4860001234567')).toBe('scanned 4860001234567');
  });

  it('keeps an EAN-8 barcode', () => {
    expect(scrubText('scanned 48600012')).toBe('scanned 48600012');
  });

  it('keeps a 13-digit run containing 995', () => {
    // Regression: a phone pattern bounded only on the right matches the
    // 12-char tail of this run and leaves "8[Filtered]".
    expect(scrubText('scanned 8995123456789')).toBe('scanned 8995123456789');
  });

  it('restores the character before a masked phone', () => {
    // The left bound is a captured character, not a zero-width assertion.
    expect(scrubText('tel:+995555123456')).toBe(`tel:${REDACTED}`);
  });

  it('passes non-strings through', () => {
    expect(scrubText(42)).toBe(42);
    expect(scrubText(null)).toBeNull();
  });
});

describe('scrubValue', () => {
  it('redacts sensitive keys at depth', () => {
    const result = scrubValue({payload: {phone: '555111222', status: 'ok'}});
    expect(result.payload.phone).toBe(REDACTED);
    expect(result.payload.status).toBe('ok');
  });

  it('redacts sensitive keys inside arrays', () => {
    const result = scrubValue({clients: [{first_name: 'Nino'}]});
    expect(result.clients[0].first_name).toBe(REDACTED);
  });

  it('redacts query-string keys', () => {
    const result = scrubValue({
      'http.query': 'q=Rustaveli+7&lat=41.7151',
      'url.query': 'q=Rustaveli+7',
      'http.fragment': 'pin',
      query_string: 'customer_search=Nino Beridze',
    });
    expect(result['http.query']).toBe(REDACTED);
    expect(result['url.query']).toBe(REDACTED);
    expect(result['http.fragment']).toBe(REDACTED);
    expect(result.query_string).toBe(REDACTED);
  });

  it('strips the query from URL keys, keeping scheme host and path', () => {
    const result = scrubValue({
      url: 'https://api.example.com/api/v1/orders/?customer_search=Nino',
      'url.full': 'https://api.example.com/api/v1/orders/?customer_search=Nino',
      'http.url': 'https://api.example.com/api/v1/orders/?customer_search=Nino',
    });
    expect(result.url).toBe('https://api.example.com/api/v1/orders/');
    expect(result['url.full']).toBe('https://api.example.com/api/v1/orders/');
    expect(result['http.url']).toBe('https://api.example.com/api/v1/orders/');
  });
});

describe('stripQuery', () => {
  it('drops the query string', () => {
    expect(stripQuery('https://photon.komoot.io/api?q=Rustaveli+7'))
      .toBe('https://photon.komoot.io/api');
  });

  it('keeps a URL without a query', () => {
    expect(stripQuery('https://photon.komoot.io/api'))
      .toBe('https://photon.komoot.io/api');
  });

  it('passes non-strings through', () => {
    expect(stripQuery(null)).toBeNull();
  });
});

describe('scrubEvent', () => {
  it('masks an id inside an exception value', () => {
    const event = {exception: {values: [{value: 'no client for 01008012345'}]}};
    expect(scrubEvent(event).exception.values[0].value)
      .toBe(`no client for ${REDACTED}`);
  });

  it('drops the event when scrubbing throws', () => {
    // Fail closed: a circular structure makes the walk throw.
    const circular = {};
    circular.self = circular;
    expect(scrubEvent(circular)).toBeNull();
  });

  it('scrubs a transaction event, the shape beforeSend never sees', () => {
    // @sentry/core/fetch.js puts the query in four places on every span.
    const transaction = {
      type: 'transaction',
      spans: [{
        op: 'http.client',
        description: 'GET https://api.example.com/api/v1/orders/',
        data: {
          url: 'https://api.example.com/api/v1/orders/?customer_search=Nino',
          'http.url': 'https://api.example.com/api/v1/orders/?customer_search=Nino',
          'url.full': 'https://api.example.com/api/v1/orders/?customer_search=Nino',
          'http.query': 'customer_search=Nino Beridze',
        },
      }],
    };
    const {data} = scrubEvent(transaction).spans[0];
    expect(data['http.query']).toBe(REDACTED);
    expect(data.url).toBe('https://api.example.com/api/v1/orders/');
    expect(data['http.url']).toBe('https://api.example.com/api/v1/orders/');
    expect(data['url.full']).toBe('https://api.example.com/api/v1/orders/');
    expect(JSON.stringify(scrubEvent(transaction))).not.toContain('Nino');
  });

  it('strips the query from an XHR breadcrumb URL', () => {
    // `url` is not a sensitive key and a name has no digit shape, so nothing
    // but the URL rule reaches this one.
    const event = {breadcrumbs: {values: [{
      category: 'xhr',
      data: {url: 'https://api.example.com/api/v1/orders/?customer_search=Nino'},
    }]}};
    expect(scrubEvent(event).breadcrumbs.values[0].data.url)
      .toBe('https://api.example.com/api/v1/orders/');
  });

  it('keeps sdk metadata', () => {
    // `sdk` is Sentry protocol metadata; redacting its `name` breaks SDK
    // attribution in the UI.
    const event = {
      sdk: {name: 'sentry.javascript.react', version: '10.73.0'},
      extra: {name: 'Nino Beridze'},
    };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.sdk.name).toBe('sentry.javascript.react');
    expect(scrubbed.extra.name).toBe(REDACTED);
  });
});
