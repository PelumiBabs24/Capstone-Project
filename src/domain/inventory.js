import { DomainError } from './errors.js';
import { newId, newReference } from './ids.js';
import { Queue } from './waitlistQueue.js';

export const MAX_TICKETS_PER_BOOKING = 10;
export const WAITLIST_OFFER_TTL_MS = 15 * 60 * 1000;

function validateStore(store) {
  if (
    !store ||
    !(store.events instanceof Map) ||
    !(store.tiers instanceof Map) ||
    !(store.bookings instanceof Map) ||
    !(store.bookingsByReference instanceof Map) ||
    !(store.waitlists instanceof Map) ||
    !(store.waitlistOffers instanceof Map) ||
    !(store.activeWaitlistOfferKeys instanceof Set)
  ) {
    throw new DomainError('VALIDATION', 'A valid store is required');
  }
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainError('VALIDATION', `${field} is required`);
  }
  return value.trim();
}

function requireWholeNumber(value, field, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new DomainError('VALIDATION', `${field} must be a whole number of at least ${minimum}`);
  }
  return value;
}

function requireQuantity(quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TICKETS_PER_BOOKING) {
    throw new DomainError(
      'VALIDATION',
      `quantity must be a whole number between 1 and ${MAX_TICKETS_PER_BOOKING}`,
    );
  }
  return quantity;
}

export function seatsLeft(tier) {
  validateStoreHolder(tier);
  return tier.capacity - tier.sold - (tier.reserved ?? 0);
}

function validateStoreHolder(value) {
  if (!value || typeof value !== 'object') {
    throw new DomainError('VALIDATION', 'A valid ticket tier is required');
  }
}

function getEvent(store, eventId) {
  validateStore(store);
  requireText(eventId, 'eventId');
  const event = store.events.get(eventId);
  if (!event) throw new DomainError('NOT_FOUND', 'Event not found');
  return event;
}

function getTier(store, tierId) {
  validateStore(store);
  requireText(tierId, 'tierId');
  const tier = store.tiers.get(tierId);
  if (!tier) throw new DomainError('NOT_FOUND', 'Ticket tier not found');
  return tier;
}

export function createStore() {
  return {
    events: new Map(),
    tiers: new Map(),
    bookings: new Map(),
    bookingsByReference: new Map(),
    waitlists: new Map(),
    waitlistOffers: new Map(),
    activeWaitlistOfferKeys: new Set(),
  };
}

export function createEvent(store, input = {}) {
  validateStore(store);
  if (!input || typeof input !== 'object') {
    throw new DomainError('VALIDATION', 'Event input is required');
  }

  const title = requireText(input.title, 'title');
  const city = requireText(input.city, 'city');
  const organizerId = requireText(input.organizerId, 'organizerId');
  if (typeof input.startsAt !== 'string') {
    throw new DomainError('VALIDATION', 'startsAt must be a valid date');
  }
  const date = parseEventDate(input.startsAt);
  if (input.venue !== undefined && typeof input.venue !== 'string') {
    throw new DomainError('VALIDATION', 'venue must be text');
  }

  const event = {
    id: newId(),
    organizerId,
    title,
    city,
    venue: typeof input.venue === 'string' ? input.venue.trim() : '',
    startsAt: date.toISOString(),
    status: 'draft',
    tierIds: [],
  };
  store.events.set(event.id, event);
  return event;
}

function parseEventDate(value) {
  if (typeof value !== 'string') {
    throw new DomainError('VALIDATION', 'startsAt must be a valid ISO date');
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(
      value,
    );
  const date = new Date(value);
  if (!match || Number.isNaN(date.getTime())) {
    throw new DomainError('VALIDATION', 'startsAt must be a valid ISO date');
  }
  const [, yearText, monthText, dayText] = match;
  const calendarDate = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  if (
    calendarDate.getUTCFullYear() !== Number(yearText) ||
    calendarDate.getUTCMonth() !== Number(monthText) - 1 ||
    calendarDate.getUTCDate() !== Number(dayText)
  ) {
    throw new DomainError('VALIDATION', 'startsAt must be a real ISO date');
  }
  return date;
}

export function publishEvent(store, eventId) {
  const event = getEvent(store, eventId);
  if (event.tierIds.length === 0) {
    throw new DomainError('INVALID_STATE', 'Add at least one ticket tier before publishing');
  }
  event.status = 'published';
  return event;
}

export function unpublishEvent(store, eventId) {
  const event = getEvent(store, eventId);
  event.status = 'draft';
  return event;
}

export function listEventSummaries(store, options = {}) {
  validateStore(store);
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new DomainError('VALIDATION', 'options must be an object');
  }
  const { publishedOnly = true } = options;
  if (typeof publishedOnly !== 'boolean') {
    throw new DomainError('VALIDATION', 'publishedOnly must be a boolean');
  }

  return [...store.events.values()]
    .filter((event) => !publishedOnly || event.status === 'published')
    .map((event) => {
      const tiers = event.tierIds.map((tierId) => {
        const tier = store.tiers.get(tierId);
        if (!tier) throw new DomainError('NOT_FOUND', `Ticket tier ${tierId} not found`);
        return {
          id: tier.id,
          name: tier.name,
          priceCents: tier.priceCents,
          capacity: tier.capacity,
          sold: tier.sold,
          reserved: tier.reserved ?? 0,
          availableSeats: seatsLeft(tier),
        };
      });
      const cheapestPriceCents =
        tiers.length === 0 ? undefined : Math.min(...tiers.map((tier) => tier.priceCents));
      const availableSeats = tiers.reduce((total, tier) => total + tier.availableSeats, 0);

      return {
        id: event.id,
        organizerId: event.organizerId,
        title: event.title,
        city: event.city,
        venue: event.venue,
        startsAt: event.startsAt,
        status: event.status,
        tiers,
        cheapestPriceCents,
        availableSeats,
      };
    });
}

export function addTier(store, eventId, input = {}) {
  const event = getEvent(store, eventId);
  if (!input || typeof input !== 'object') {
    throw new DomainError('VALIDATION', 'Tier input is required');
  }

  const tier = {
    id: newId(),
    eventId,
    name: requireText(input.name, 'name'),
    priceCents: requireWholeNumber(input.priceCents, 'priceCents', 0),
    capacity: requireWholeNumber(input.capacity, 'capacity', 1),
    sold: 0,
    reserved: 0,
  };
  store.tiers.set(tier.id, tier);
  store.waitlists.set(tier.id, new Queue());
  event.tierIds.push(tier.id);
  return tier;
}

export function bookTickets(store, tierId, userId, quantity) {
  const tier = getTier(store, tierId);
  requireText(userId, 'userId');
  requireQuantity(quantity);

  const available = seatsLeft(tier);
  if (available < quantity) {
    throw new DomainError(
      'SOLD_OUT',
      available === 0 ? `${tier.name} is sold out` : `Only ${available} ticket(s) left in ${tier.name}`,
      { seatsLeft: available },
    );
  }

  tier.sold += quantity;

  let reference;
  do {
    reference = newReference();
  } while (store.bookingsByReference.has(reference));

  const booking = {
    id: newId(),
    reference,
    userId: requireText(userId, 'userId'),
    tierId,
    quantity,
    amountCents: tier.priceCents * quantity,
    status: 'pending',
  };
  store.bookings.set(booking.id, booking);
  store.bookingsByReference.set(reference, booking);
  return booking;
}

export function cancelBooking(store, reference) {
  validateStore(store);
  requireText(reference, 'Booking reference');
  const booking = findBookingByReference(store, reference);
  if (!booking) throw new DomainError('NOT_FOUND', 'Booking not found');
  if (booking.status === 'cancelled') {
    throw new DomainError('INVALID_STATE', 'Booking has already been cancelled');
  }

  const tier = getTier(store, booking.tierId);
  tier.sold -= booking.quantity;
  booking.status = 'cancelled';
  return booking;
}

export function findBookingByReference(store, reference) {
  validateStore(store);
  if (typeof reference !== 'string') return undefined;
  return store.bookingsByReference.get(reference);
}

export function joinWaitlist(store, tierId, userId, quantity) {
  const tier = getTier(store, tierId);
  requireText(userId, 'userId');
  requireQuantity(quantity);

  if (seatsLeft(tier) >= quantity) {
    throw new DomainError('NOT_SOLD_OUT', 'Seats are available, so book them instead');
  }

  const queue = store.waitlists.get(tierId);
  for (const entry of queue.toArray()) {
    if (entry.userId === userId) {
      throw new DomainError('DUPLICATE_WAITLIST_ENTRY', 'You are already on this waitlist');
    }
  }
  const offerKey = `${tierId}:${userId}`;
  if (store.activeWaitlistOfferKeys.has(offerKey)) {
    throw new DomainError('DUPLICATE_WAITLIST_ENTRY', 'You already have an active waitlist offer');
  }
  queue.enqueue({ userId, quantity });
  return { position: queue.size };
}

export function offerNextOnWaitlist(store, tierId) {
  const tier = getTier(store, tierId);
  const queue = store.waitlists.get(tierId);
  const next = queue.peek();
  if (!next || seatsLeft(tier) < next.quantity) return undefined;
  const waiting = queue.dequeue();
  const offerKey = `${tierId}:${waiting.userId}`;

  tier.reserved += waiting.quantity;
  const offer = {
    id: newId(),
    tierId,
    userId: waiting.userId,
    quantity: waiting.quantity,
    status: 'offered',
    expiresAt: new Date(Date.now() + WAITLIST_OFFER_TTL_MS).toISOString(),
  };
  store.waitlistOffers.set(offer.id, offer);
  store.activeWaitlistOfferKeys.add(offerKey);
  return offer;
}

function getWaitlistOffer(store, offerOrId) {
  validateStore(store);
  const offerId = typeof offerOrId === 'string' ? offerOrId : offerOrId?.id;
  requireText(offerId, 'offerId');
  const offer = store.waitlistOffers.get(offerId);
  if (!offer) throw new DomainError('NOT_FOUND', 'Waitlist offer not found');
  return offer;
}

function releaseWaitlistReservation(store, offer) {
  if (offer.status !== 'offered') {
    throw new DomainError('INVALID_STATE', `A ${offer.status} waitlist offer cannot be released`);
  }
  const tier = getTier(store, offer.tierId);
  tier.reserved -= offer.quantity;
  if (tier.reserved < 0) {
    tier.reserved = 0;
  }
  const offerKey = `${offer.tierId}:${offer.userId}`;
  store.activeWaitlistOfferKeys.delete(offerKey);
}

export function acceptWaitlistOffer(store, offerOrId) {
  const offer = getWaitlistOffer(store, offerOrId);
  if (offer.status !== 'offered') {
    throw new DomainError('INVALID_STATE', `A ${offer.status} waitlist offer cannot be accepted`);
  }
  if (Date.now() >= new Date(offer.expiresAt).getTime()) {
    expireWaitlistOffer(store, offer.id);
    throw new DomainError('OFFER_EXPIRED', 'The waitlist offer has expired');
  }

  const tier = getTier(store, offer.tierId);
  let reference;
  do {
    reference = newReference();
  } while (store.bookingsByReference.has(reference));

  tier.reserved -= offer.quantity;
  tier.sold += offer.quantity;
  const booking = {
    id: newId(),
    reference,
    userId: offer.userId,
    tierId: offer.tierId,
    quantity: offer.quantity,
    amountCents: tier.priceCents * offer.quantity,
    status: 'pending',
  };
  offer.status = 'accepted';
  store.bookings.set(booking.id, booking);
  store.bookingsByReference.set(reference, booking);
  store.activeWaitlistOfferKeys.delete(`${offer.tierId}:${offer.userId}`);
  return booking;
}

export function rejectWaitlistOffer(store, offerOrId) {
  const offer = getWaitlistOffer(store, offerOrId);
  releaseWaitlistReservation(store, offer);
  offer.status = 'rejected';
  return offer;
}

export function expireWaitlistOffer(store, offerOrId) {
  const offer = getWaitlistOffer(store, offerOrId);
  releaseWaitlistReservation(store, offer);
  offer.status = 'expired';
  return offer;
}

export function expireWaitlistOffers(store, now = Date.now()) {
  validateStore(store);
  const timestamp = typeof now === 'number' ? now : new Date(now).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new DomainError('VALIDATION', 'now must be a valid time');
  }

  const expired = [];
  for (const offer of store.waitlistOffers.values()) {
    if (offer.status === 'offered' && timestamp >= new Date(offer.expiresAt).getTime()) {
      releaseWaitlistReservation(store, offer);
      offer.status = 'expired';
      expired.push(offer);
    }
  }
  return expired;
}
