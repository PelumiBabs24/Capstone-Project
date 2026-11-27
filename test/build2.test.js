import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError } from '../src/domain/errors.js';
import {
  addTier,
  bookTickets,
  createEvent,
  createStore,
  listEventSummaries,
  publishEvent,
  seatsLeft,
  unpublishEvent,
} from '../src/domain/inventory.js';
import { filterEvents, searchEvents, sortEvents } from '../src/domain/eventSearch.js';
import { mergeSort } from '../src/domain/sorting.js';

function expectCode(action, code) {
  assert.throws(action, (error) => error instanceof DomainError && error.code === code);
}

function setupStore() {
  const store = createStore();
  const event = createEvent(store, {
    title: 'Lagos Tech Meetup',
    city: 'Lagos',
    venue: 'Yaba Hub',
    startsAt: '2026-12-05T17:00:00.000Z',
    organizerId: 'organizer-1',
  });
  return { store, event };
}

function makeSummary({
  id,
  title,
  city = 'Lagos',
  venue = 'Community Hall',
  startsAt = '2026-12-05T17:00:00.000Z',
  tiers = [],
}) {
  return { id, title, city, venue, startsAt, tiers };
}

test('S02: new event is saved as a draft with an id and hidden publicly', () => {
  const { store, event } = setupStore();
  assert.ok(event.id);
  assert.equal(event.status, 'draft');
  assert.deepEqual(listEventSummaries(store), []);
  assert.equal(listEventSummaries(store, { publishedOnly: false }).length, 1);
});

test('S02: missing title, city, or a real ISO date fails without saving', () => {
  const { store } = setupStore();
  const originalCount = store.events.size;
  const valid = {
    title: 'Valid title',
    city: 'Lagos',
    venue: 'Yaba Hub',
    startsAt: '2026-12-05T17:00:00.000Z',
    organizerId: 'organizer-1',
  };

  for (const invalid of [
    { ...valid, title: ' ' },
    { ...valid, city: '' },
    { ...valid, startsAt: '2026-02-30T17:00:00.000Z' },
    { ...valid, startsAt: 'not-a-date' },
  ]) {
    expectCode(() => createEvent(store, invalid), 'VALIDATION');
    assert.equal(store.events.size, originalCount);
  }
});

test('S02: an ISO date-only value is accepted and normalized', () => {
  const { store } = setupStore();
  const event = createEvent(store, {
    title: 'Date-only event',
    city: 'Lagos',
    startsAt: '2026-12-05',
    organizerId: 'organizer-1',
  });
  assert.equal(event.startsAt, '2026-12-05T00:00:00.000Z');
});

test('S03: tier has integer price, zero sold, and full capacity available', () => {
  const { store, event } = setupStore();
  const tier = addTier(store, event.id, {
    name: 'General',
    priceCents: 500000,
    capacity: 100,
  });

  assert.equal(tier.sold, 0);
  assert.equal(seatsLeft(tier), 100);
  assert.equal(tier.priceCents, 500000);
});

test('S03: fractional price and capacity below one fail validation', () => {
  const { store, event } = setupStore();
  expectCode(() => addTier(store, event.id, {
    name: 'Fractional',
    priceCents: 500000.5,
    capacity: 100,
  }), 'VALIDATION');
  expectCode(() => addTier(store, event.id, {
    name: 'No seats',
    priceCents: 500000,
    capacity: 0,
  }), 'VALIDATION');
  assert.equal(store.tiers.size, 0);
});

test('S03: adding a tier to an unknown event returns NOT_FOUND', () => {
  const { store } = setupStore();
  expectCode(() => addTier(store, 'missing-event', {
    name: 'General',
    priceCents: 500000,
    capacity: 100,
  }), 'NOT_FOUND');
});

test('S04: publishing a tiered event makes it visible', () => {
  const { store, event } = setupStore();
  addTier(store, event.id, { name: 'General', priceCents: 2500, capacity: 3 });

  assert.equal(publishEvent(store, event.id).status, 'published');
  assert.equal(listEventSummaries(store).length, 1);
});

test('S04: unpublishing returns event to draft and hides it publicly', () => {
  const { store, event } = setupStore();
  addTier(store, event.id, { name: 'General', priceCents: 2500, capacity: 3 });
  publishEvent(store, event.id);

  assert.equal(unpublishEvent(store, event.id).status, 'draft');
  assert.deepEqual(listEventSummaries(store), []);
});

test('S04: publishing without tiers fails and leaves event unpublished', () => {
  const { store, event } = setupStore();
  expectCode(() => publishEvent(store, event.id), 'INVALID_STATE');
  assert.equal(event.status, 'draft');
  assert.deepEqual(listEventSummaries(store), []);
});

test('S05: text search matches title or venue without case sensitivity', () => {
  const events = [
    makeSummary({ id: '1', title: 'Lagos Tech Meetup' }),
    makeSummary({ id: '2', title: 'Abuja Jazz Night' }),
    makeSummary({ id: '3', title: 'Night Market', venue: 'JAZZ HALL' }),
  ];

  assert.deepEqual(filterEvents(events, { q: 'JAZZ' }), [events[1], events[2]]);
});

test('S05: city filter is exact except for letter case', () => {
  const events = [
    makeSummary({ id: '1', title: 'Lagos Event', city: 'Lagos' }),
    makeSummary({ id: '2', title: 'Other Lagos Event', city: 'LAGOS' }),
    makeSummary({ id: '3', title: 'Abuja Event', city: 'Abuja' }),
  ];

  assert.deepEqual(filterEvents(events, { city: 'lagos' }), [events[0], events[1]]);
});

test('S05: price filter uses cheapest tier, excludes no-tier events, and sorts cheapest first', () => {
  const events = [
    makeSummary({ id: '1', title: 'Mid-price', tiers: [{ priceCents: 3000, capacity: 10, sold: 0 }] }),
    makeSummary({ id: '2', title: 'Cheap', tiers: [
      { priceCents: 4000, capacity: 5, sold: 0 },
      { priceCents: 1500, capacity: 5, sold: 0 },
    ] }),
    makeSummary({ id: '3', title: 'No tier' }),
    makeSummary({ id: '4', title: 'Too expensive', tiers: [{ priceCents: 5000, capacity: 5, sold: 0 }] }),
  ];

  assert.deepEqual(searchEvents(events, { maxPriceCents: 3000 }, 'price').map((event) => event.id), ['2', '1']);
});

test('S05: date sorting breaks same-date ties by title then id', () => {
  const events = [
    makeSummary({ id: 'b', title: 'Zulu', startsAt: '2026-12-05T09:00:00.000Z' }),
    makeSummary({ id: '2', title: 'Alpha', startsAt: '2026-12-05T17:00:00.000Z' }),
    makeSummary({ id: '1', title: 'Alpha', startsAt: '2026-12-05T17:00:00.000Z' }),
    makeSummary({ id: 'early', title: 'Later title', startsAt: '2026-12-04T20:00:00.000Z' }),
  ];

  assert.deepEqual(sortEvents(events, 'date').map((event) => event.id), ['early', 'b', '1', '2']);
});

test('S05: date-only "to" includes events later on that date', () => {
  const event = makeSummary({ id: '1', title: 'Evening event' });
  assert.deepEqual(filterEvents([event], { to: '2026-12-05' }), [event]);
});

test('S05: from and to bounds include events exactly at the boundary', () => {
  const event = makeSummary({
    id: '1',
    title: 'Boundary event',
    startsAt: '2026-12-05T17:00:00.000Z',
  });
  assert.deepEqual(filterEvents([event], {
    from: '2026-12-05T17:00:00.000Z',
    to: '2026-12-05T17:00:00.000Z',
  }), [event]);
});

test('S05: invalid dates, fractional prices, and unknown sorts return VALIDATION', () => {
  const event = makeSummary({ id: '1', title: 'Event' });
  expectCode(() => filterEvents([event], { from: '2026-02-30' }), 'VALIDATION');
  expectCode(() => filterEvents([event], { maxPriceCents: 10.5 }), 'VALIDATION');
  expectCode(() => sortEvents([event], 'popularity'), 'VALIDATION');
});

test('S05: availability sorts most seats first and onlyAvailable filters sold-out events', () => {
  const events = [
    makeSummary({ id: '1', title: 'Sold out', tiers: [{ priceCents: 1000, capacity: 2, sold: 2 }] }),
    makeSummary({ id: '2', title: 'Two left', tiers: [{ priceCents: 1000, capacity: 3, sold: 1 }] }),
    makeSummary({ id: '3', title: 'Five left', tiers: [{ priceCents: 1000, capacity: 5, sold: 0 }] }),
  ];
  assert.deepEqual(sortEvents(events, 'availability').map((event) => event.id), ['3', '2', '1']);
  assert.deepEqual(filterEvents(events, { onlyAvailable: true }).map((event) => event.id), ['2', '3']);
});

test('S05: price sorting puts events without tiers last', () => {
  const events = [
    makeSummary({ id: '1', title: 'No price' }),
    makeSummary({ id: '2', title: 'Priced', tiers: [{ priceCents: 500, capacity: 1, sold: 0 }] }),
  ];
  assert.deepEqual(sortEvents(events, 'price').map((event) => event.id), ['2', '1']);
});

test('sorting and filtering return new lists without changing the original list', () => {
  const original = [
    makeSummary({ id: '2', title: 'Beta', city: 'Lagos' }),
    makeSummary({ id: '1', title: 'Alpha', city: 'Abuja' }),
  ];
  const snapshot = original.slice();

  const sorted = sortEvents(original, 'date');
  const filtered = filterEvents(original, { city: 'lagos' });

  assert.notStrictEqual(sorted, original);
  assert.notStrictEqual(filtered, original);
  assert.deepEqual(original, snapshot);
});

test('mergeSort is stable and returns a new array without mutating input', () => {
  const original = [
    { key: 2, order: 'first-two' },
    { key: 1, order: 'one' },
    { key: 2, order: 'second-two' },
  ];
  const sorted = mergeSort(original, (left, right) => left.key - right.key);

  assert.notStrictEqual(sorted, original);
  assert.deepEqual(sorted.map((item) => item.order), ['one', 'first-two', 'second-two']);
  assert.deepEqual(original.map((item) => item.order), ['first-two', 'one', 'second-two']);
});

test('empty lists remain empty through filtering, sorting, and searching', () => {
  assert.deepEqual(filterEvents([], { q: 'anything' }), []);
  assert.deepEqual(sortEvents([], 'price'), []);
  assert.deepEqual(searchEvents([], {}, 'availability'), []);
});

test('S06: booking two of three tickets creates a pending whole-cent booking', () => {
  const { store, event } = setupStore();
  const tier = addTier(store, event.id, { name: 'General', priceCents: 2500, capacity: 3 });
  publishEvent(store, event.id);

  const booking = bookTickets(store, tier.id, 'attendee-1', 2);
  assert.equal(booking.status, 'pending');
  assert.equal(booking.quantity, 2);
  assert.equal(booking.amountCents, 5000);
  assert.equal(seatsLeft(tier), 1);
});

test('S06: sold-out booking returns SOLD_OUT and changes nothing', () => {
  const { store, event } = setupStore();
  const tier = addTier(store, event.id, { name: 'General', priceCents: 2500, capacity: 3 });
  bookTickets(store, tier.id, 'attendee-1', 2);
  const bookingsBefore = store.bookings.size;
  const soldBefore = tier.sold;

  expectCode(() => bookTickets(store, tier.id, 'attendee-2', 2), 'SOLD_OUT');
  assert.equal(store.bookings.size, bookingsBefore);
  assert.equal(tier.sold, soldBefore);
  assert.equal(seatsLeft(tier), 1);
});

test('S06: invalid booking quantities return VALIDATION', () => {
  const { store, event } = setupStore();
  const tier = addTier(store, event.id, { name: 'General', priceCents: 2500, capacity: 20 });

  for (const quantity of [0, -1, 1.5, 11]) {
    expectCode(() => bookTickets(store, tier.id, 'attendee-1', quantity), 'VALIDATION');
  }
  assert.equal(store.bookings.size, 0);
  assert.equal(tier.sold, 0);
});

test('listEventSummaries rejects invalid options with VALIDATION', () => {
  const { store } = setupStore();
  expectCode(() => listEventSummaries(store, { publishedOnly: 'yes' }), 'VALIDATION');
});
