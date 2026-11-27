import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError } from '../src/domain/errors.js';
import {
  acceptWaitlistOffer,
  addTier,
  bookTickets,
  cancelBooking,
  createEvent,
  createStore,
  expireWaitlistOffer,
  expireWaitlistOffers,
  joinWaitlist,
  offerNextOnWaitlist,
  rejectWaitlistOffer,
  seatsLeft,
} from '../src/domain/inventory.js';

function setupCapacity(count = 3) {
  const store = createStore();
  const event = createEvent(store, {
    title: 'Waitlist Test',
    city: 'Lagos',
    startsAt: '2026-12-05T17:00:00Z',
    organizerId: 'organizer-1',
  });
  const tier = addTier(store, event.id, {
    name: 'General',
    priceCents: 2500,
    capacity: count,
  });
  return { store, tier };
}

function sellOut(store, tier, quantity = tier.capacity) {
  return bookTickets(store, tier.id, 'seller', quantity);
}

test('offering reserves seats and prevents duplicate offers', () => {
  const { store, tier } = setupCapacity(3);
  const seller = sellOut(store, tier);
  joinWaitlist(store, tier.id, 'ada', 2);

  assert.throws(
    () => joinWaitlist(store, tier.id, 'ada', 2),
    (error) => error instanceof DomainError && error.code === 'DUPLICATE_WAITLIST_ENTRY',
  );
  assert.throws(
    () => joinWaitlist(store, tier.id, 'ada', 1),
    (error) => error instanceof DomainError && error.code === 'DUPLICATE_WAITLIST_ENTRY',
  );

  cancelBooking(store, seller.reference);
  const offer = offerNextOnWaitlist(store, tier.id);
  assert.equal(offer.userId, 'ada');
  assert.equal(offer.quantity, 2);
  assert.equal(seatsLeft(tier), 1);
  assert.equal(tier.reserved, 2);

  assert.throws(
    () => joinWaitlist(store, tier.id, 'ada', 2),
    (error) => error instanceof DomainError && error.code === 'DUPLICATE_WAITLIST_ENTRY',
  );
  assert.equal(offerNextOnWaitlist(store, tier.id), undefined);
});

test('accepting an offer converts its reservation into a booking', () => {
  const { store, tier } = setupCapacity(3);
  const seller = sellOut(store, tier);
  joinWaitlist(store, tier.id, 'ada', 2);
  cancelBooking(store, seller.reference);
  const offer = offerNextOnWaitlist(store, tier.id);

  const booking = acceptWaitlistOffer(store, offer.id);

  assert.equal(booking.userId, 'ada');
  assert.equal(booking.quantity, 2);
  assert.equal(booking.amountCents, 5000);
  assert.equal(tier.reserved, 0);
  assert.equal(tier.sold, 2);
  assert.equal(seatsLeft(tier), 1);
});

test('rejecting an offer releases its reservation', () => {
  const { store, tier } = setupCapacity(3);
  const seller = sellOut(store, tier);
  joinWaitlist(store, tier.id, 'ada', 2);
  cancelBooking(store, seller.reference);
  const offer = offerNextOnWaitlist(store, tier.id);

  const rejected = rejectWaitlistOffer(store, offer.id);

  assert.equal(rejected.status, 'rejected');
  assert.equal(tier.reserved, 0);
  assert.equal(seatsLeft(tier), 3);
  assert.equal(store.activeWaitlistOfferKeys.has(`${tier.id}:ada`), false);
});

test('expired offers release reservations and maintain FIFO order', () => {
  const { store, tier } = setupCapacity(3);
  const seller = sellOut(store, tier);
  joinWaitlist(store, tier.id, 'ada', 1);
  joinWaitlist(store, tier.id, 'bayo', 1);

  cancelBooking(store, seller.reference);
  const adaOffer = offerNextOnWaitlist(store, tier.id);
  assert.equal(adaOffer.userId, 'ada');
  assert.equal(tier.reserved, 1);
  assert.equal(seatsLeft(tier), 2);

  expireWaitlistOffers(store, Date.now() + 16 * 60 * 1000);
  assert.equal(adaOffer.status, 'expired');
  assert.equal(tier.reserved, 0);
  assert.equal(seatsLeft(tier), 3);

  const bayoOffer = offerNextOnWaitlist(store, tier.id);
  assert.equal(bayoOffer.userId, 'bayo');
});

test('a single offer can only be expired once', () => {
  const { store, tier } = setupCapacity(2);
  const seller = sellOut(store, tier);
  joinWaitlist(store, tier.id, 'ada', 1);
  cancelBooking(store, seller.reference);
  const offer = offerNextOnWaitlist(store, tier.id);

  expireWaitlistOffer(store, offer.id);
  assert.equal(offer.status, 'expired');
  assert.throws(
    () => expireWaitlistOffer(store, offer.id),
    (error) => error instanceof DomainError && error.code === 'INVALID_STATE',
  );
  assert.equal(tier.reserved, 0);
});

test('an expired offer cannot be accepted', () => {
  const { store, tier } = setupCapacity(2);
  const seller = sellOut(store, tier);
  joinWaitlist(store, tier.id, 'ada', 1);
  cancelBooking(store, seller.reference);
  const offer = offerNextOnWaitlist(store, tier.id);
  offer.expiresAt = new Date(Date.now() - 1).toISOString();

  assert.throws(
    () => acceptWaitlistOffer(store, offer.id),
    (error) => error instanceof DomainError && error.code === 'OFFER_EXPIRED',
  );
  assert.equal(offer.status, 'expired');
  assert.equal(tier.reserved, 0);
});
