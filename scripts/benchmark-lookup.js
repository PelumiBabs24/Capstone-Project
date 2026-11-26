import { randomInt } from 'node:crypto';
import { newReference } from '../src/domain/ids.js';

const BOOKINGS = 100_000;
const LOOKUPS = 500;

const bookings = [];
const bookingMap = new Map();

for (let index = 0; index < BOOKINGS; index += 1) {
  const booking = { reference: newReference(), number: index };
  bookings.push(booking);
  bookingMap.set(booking.reference, booking);
}

const targets = Array.from(
  { length: LOOKUPS },
  () => bookings[randomInt(BOOKINGS)].reference,
);

function measure(label, lookup) {
  const start = performance.now();
  for (const reference of targets) lookup(reference);
  const elapsed = performance.now() - start;
  console.log(`${label.padEnd(12)} ${elapsed.toFixed(2).padStart(10)} ms for ${LOOKUPS} lookups`);
  return elapsed;
}

console.log(`${BOOKINGS.toLocaleString()} bookings in memory\n`);
const arrayTime = measure('Array.find', (reference) =>
  bookings.find((booking) => booking.reference === reference),
);
const mapTime = measure('Map.get', (reference) => bookingMap.get(reference));
console.log(`\nMap.get was about ${Math.round(arrayTime / Math.max(mapTime, 0.001)).toLocaleString()}x faster.`);
