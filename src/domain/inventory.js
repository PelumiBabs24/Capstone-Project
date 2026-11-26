import { DomainError } from './errors.js';
import { newId, newReference } from './ids.js';
import { Queue } from './waitlistQueue.js';

export const MAX_TICKETS_PER_BOOKING = 10;

function validateStore(store) {
  if (
    !store ||
    !(store.events instanceof Map) ||
    !(store.tiers instanceof Map) ||
    !(store.bookings instanceof Map) ||
    !(store.bookingsByReference instanceof Map) ||
    !(store.waitlists instanceof Map)
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
  return tier.capacity - tier.sold;
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
  const date = new Date(input.startsAt);
  if (Number.isNaN(date.getTime())) {
    throw new DomainError('VALIDATION', 'startsAt must be a valid date');
  }
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
  queue.enqueue({ userId, quantity });
  return { position: queue.size };
}

export function offerNextOnWaitlist(store, tierId) {
  const tier = getTier(store, tierId);
  const queue = store.waitlists.get(tierId);
  const next = queue.peek();
  if (!next || seatsLeft(tier) < next.quantity) return undefined;
  return queue.dequeue();
}
