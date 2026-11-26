import { DomainError } from '../src/domain/errors.js';
import {
  addTier,
  bookTickets,
  cancelBooking,
  createEvent,
  createStore,
  findBookingByReference,
  joinWaitlist,
  offerNextOnWaitlist,
  seatsLeft,
} from '../src/domain/inventory.js';

const store = createStore();
const event = createEvent(store, {
  title: 'Lagos Tech Meetup',
  city: 'Lagos',
  venue: 'Yaba Hub',
  startsAt: '2026-12-05T17:00:00Z',
  organizerId: 'organizer-1',
});
const tier = addTier(store, event.id, {
  name: 'General',
  priceCents: 500_000,
  capacity: 3,
});

console.log(`Created "${event.title}" with ${tier.capacity} seats.\n`);

function attempt(label, action) {
  try {
    const result = action();
    console.log(`OK    ${label}`);
    return result;
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    console.log(`FAIL  ${label} -> ${error.code}: ${error.message}`);
  }
  return undefined;
}

const ada = attempt('Ada books 2 tickets', () => bookTickets(store, tier.id, 'ada', 2));
attempt('Bayo is refused 2 tickets', () => bookTickets(store, tier.id, 'bayo', 2));
const bayo = attempt('Bayo books 1 ticket', () => bookTickets(store, tier.id, 'bayo', 1));

console.log(`\nEvent sells out. Seats left: ${seatsLeft(tier)}\n`);

attempt('Chidi joins the waitlist for 2 seats', () => joinWaitlist(store, tier.id, 'chidi', 2));
attempt('Dayo joins the waitlist for 1 seat', () => joinWaitlist(store, tier.id, 'dayo', 1));

console.log(`\nAda's booking: ${findBookingByReference(store, ada.reference).reference}`);
attempt('Ada cancels', () => cancelBooking(store, ada.reference));
console.log(`Seats released: ${seatsLeft(tier)}\n`);

const next = offerNextOnWaitlist(store, tier.id);
console.log(`Next person in line: ${next?.userId ?? 'none'}`);
