import {REDACTED, scrubEvent, scrubText, scrubValue} from './scrub';

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
});
