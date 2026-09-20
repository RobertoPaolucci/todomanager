// Pure preparation/simulation. No database client or mutation path.
export function parseAuditCsv(text) {
  const table = [];
  let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ';' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\r' || c === '\n') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(Boolean)) table.push(row);
      row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('Invalid quoted CSV');
  if (field || row.length) { row.push(field); table.push(row); }
  const headers = table.shift();
  if (!headers || new Set(headers).size !== headers.length) throw new Error('Invalid CSV header');
  return table.map(values => {
    if (values.length !== headers.length) throw new Error('Invalid CSV row');
    return Object.fromEntries(headers.map((key, i) => [key, values[i]]));
  });
}

// Exact decimal comparison: 120.0000 is 120, but 120.0001 must NEVER round to 120.
export function exactCents(value) {
  if (!['string', 'number'].includes(typeof value)) throw new Error('Invalid money');
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(String(value));
  if (!match || /[1-9]/.test((match[3] || '').slice(2))) throw new Error('Invalid money precision');
  const amount = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0').slice(0, 2));
  const result = Number(match[1] ? -amount : amount);
  if (!Number.isSafeInteger(result)) throw new Error('Money exceeds safe range');
  return result;
}

function validId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid ID');
  return Number(value);
}

export function prepareCandidates(autoRows, reviewRows, originalSnapshot) {
  const reviewIds = new Set(reviewRows.map(r => validId(r.todo_manager_id)));
  if (reviewIds.size !== reviewRows.length) throw new Error('Duplicate REVIEW ID');
  const original = new Map(originalSnapshot.rows.map(r => [r.id, r]));
  const ids = new Set(), codes = new Set(), candidates = [], alreadyCorrect = [];
  for (const row of autoRows) {
    const id = validId(row.todo_manager_id), prior = original.get(id);
    if (ids.has(id) || reviewIds.has(id)) throw new Error('Duplicate ID or REVIEW overlap');
    ids.add(id);
    if (row.gruppo !== 'AUTO_FIX' || row.avvisi || row.motivi_review || !['COINCIDE', 'DIFFERISCE'].includes(row.esito)
      || row.valuta_bokun !== 'EUR' || row.stato_bokun !== 'CONFIRMED') throw new Error('Unsafe AUTO_FIX row');
    const code = row.confirmationCode_bokun_trovato;
    if (!/^VIA-\d+$/.test(code) || codes.has(code)) throw new Error('Invalid/shared confirmation code');
    codes.add(code);
    const before = exactCents(row.total_to_you_attuale), after = exactCents(row.totalPrice_bokun);
    const cost = exactCents(row.total_supplier_cost), margin = exactCents(row.margine_attuale);
    if (after < 0 || exactCents(row.differenza_eur) !== after - before
      || exactCents(row.margine_corretto) !== after - cost) throw new Error('Report arithmetic mismatch');
    if (!prior || prior.channel_id !== 2 || prior.booking_reference !== row.booking_reference
      || prior.booking_date !== row.data_esperienza || prior.experience_name !== row.esperienza
      || (prior.bokun_booking_reference ?? '') !== row.bokun_booking_reference_attuale
      || exactCents(prior.total_to_you) !== before || exactCents(prior.total_supplier_cost) !== cost
      || exactCents(prior.margin_total) !== margin) throw new Error('Original snapshot mismatch');
    const expected = {
      id, booking_reference: prior.booking_reference, bokun_booking_reference: prior.bokun_booking_reference,
      business_unit_id: prior.business_unit_id, channel_id: prior.channel_id,
      experience_id: prior.experience_id, experience_name: prior.experience_name, booking_date: prior.booking_date,
      adults: prior.adults, children: prior.children, infants: prior.infants, total_people: prior.total_people,
      total_to_you: before / 100, total_supplier_cost: cost / 100, margin_total: margin / 100,
    };
    const candidate = { id, expected, confirmationCode: code, targetCents: after,
      productId: originalSnapshot.experiences.find(e => e.id === prior.experience_id)?.bokun_id };
    if (!candidate.productId) throw new Error('Missing audited product');
    (before === after ? alreadyCorrect : candidates).push(candidate);
  }
  return { candidates, alreadyCorrect, reviewIds: [...reviewIds] };
}

export function simulateBackfill(prepared, current) {
  const currentById = new Map(current.bookings.map(b => [b.id, b]));
  if (currentById.size !== current.bookings.length) throw new Error('Duplicate live ID');
  const products = new Map(current.experiences.map(e => [e.id, e.bokun_id]));
  const reviewIds = new Set(prepared.reviewIds);
  const results = prepared.candidates.map(candidate => {
    const { id, expected, confirmationCode, targetCents } = candidate;
    const b = currentById.get(id), reasons = [];
    if (reviewIds.has(id)) reasons.push('REVIEW_EXCLUDED');
    if (!b) reasons.push('ID_NOT_FOUND');
    else {
      if (b.booking_reference !== expected.booking_reference) reasons.push('BOOKING_REFERENCE_CHANGED');
      if (b.is_cancelled !== false || b.cancelled_at) reasons.push('CANCELLED_OR_UNKNOWN_STATUS');
      for (const field of ['total_to_you', 'total_supplier_cost', 'margin_total']) {
        try { if (exactCents(b[field]) !== exactCents(expected[field])) reasons.push(`${field.toUpperCase()}_CHANGED`); }
        catch { reasons.push(`${field.toUpperCase()}_INVALID`); }
      }
      for (const field of ['business_unit_id', 'channel_id', 'experience_id', 'experience_name', 'booking_date',
        'adults', 'children', 'infants', 'total_people']) {
        if (b[field] !== expected[field]) reasons.push(`${field.toUpperCase()}_CHANGED`);
      }
      if (!b.business_unit_id || b.channel_id !== 2) reasons.push('INVALID_VIATOR_SCOPE');
      if (String(products.get(b.experience_id)) !== String(candidate.productId)) reasons.push('PRODUCT_MAPPING_CHANGED');
      if (b.bokun_booking_reference !== null && b.bokun_booking_reference !== confirmationCode) reasons.push('BOKUN_REFERENCE_CONFLICT');
      // Check all current bookings, including cancelled and REVIEW, without modifying any of them.
      if (current.bookings.some(other => other.id !== id &&
        (other.bokun_booking_reference === confirmationCode ||
          (other.is_cancelled === false && other.channel_id === 2 && other.booking_reference === expected.booking_reference)))) {
        reasons.push('BOKUN_OR_EXTERNAL_REFERENCE_SHARED');
      }
    }
    if (reasons.length) return { id, status: 'SKIPPED', reasons, proposal: null };
    const proposal = {
      total_to_you: targetCents / 100,
      margin_total: (targetCents - exactCents(b.total_supplier_cost)) / 100,
      total_to_you_source: 'bokun_api_backfill',
      ...(b.bokun_booking_reference === null ? { bokun_booking_reference: confirmationCode } : {}),
    };
    return { id, status: 'PASS', reasons: [], before: { ...b }, proposal };
  });
  const passed = results.filter(r => r.status === 'PASS');
  const sum = (getValue) => passed.reduce((n, r) => n + exactCents(getValue(r)), 0) / 100;
  const summary = {
    expected: prepared.candidates.length, pass: passed.length, skipped: results.length - passed.length,
    alreadyCorrectUntouched: prepared.alreadyCorrect.length,
    totalToYouBefore: sum(r => r.before.total_to_you), totalToYouAfter: sum(r => r.proposal.total_to_you),
    marginBefore: sum(r => r.before.margin_total), marginAfter: sum(r => r.proposal.margin_total),
    revenueDelta: passed.reduce((n, r) => n + exactCents(r.proposal.total_to_you) - exactCents(r.before.total_to_you), 0) / 100,
    marginDelta: passed.reduce((n, r) => n + exactCents(r.proposal.margin_total) - exactCents(r.before.margin_total), 0) / 100,
    bokunReferencesToPopulate: passed.filter(r => Object.hasOwn(r.proposal, 'bokun_booking_reference')).length,
    reviewExcluded: reviewIds.size, reviewIncluded: passed.filter(r => reviewIds.has(r.id)).length,
  };
  return { capturedAt: current.capturedAt, dryRun: true, applied: false, summary, rows: results };
}
