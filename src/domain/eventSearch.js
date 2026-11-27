import { DomainError } from './errors.js';
import { mergeSort } from './sorting.js';

const DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2}))?$/;

function requireSummaries(summaries) {
  if (!Array.isArray(summaries)) {
    throw new DomainError('VALIDATION', 'summaries must be an array');
  }
  for (const summary of summaries) {
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
      throw new DomainError('VALIDATION', 'each event summary must be an object');
    }
  }
}

function requireCriteria(criteria) {
  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) {
    throw new DomainError('VALIDATION', 'criteria must be an object');
  }
}

function parseIsoDate(value, field, endOfDate = false) {
  if (typeof value !== 'string') {
    throw new DomainError('VALIDATION', `${field} must be an ISO date string`);
  }
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    throw new DomainError('VALIDATION', `${field} must be an ISO date string`);
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    throw new DomainError('VALIDATION', `${field} must be a real date`);
  }

  if (endOfDate && !match[4]) {
    return Date.UTC(year, month - 1, day + 1) - 1;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new DomainError('VALIDATION', `${field} must be a valid ISO date`);
  }
  return timestamp;
}

function requireTextOption(value, field) {
  if (value !== undefined && typeof value !== 'string') {
    throw new DomainError('VALIDATION', `${field} must be text`);
  }
  return value?.trim().toLowerCase();
}

function getTierPrices(summary) {
  if (Array.isArray(summary.tiers)) {
    return summary.tiers.map((tier) => {
      if (!tier || typeof tier !== 'object') {
        throw new DomainError('VALIDATION', 'each ticket tier must be an object');
      }
      if (!Number.isInteger(tier.priceCents) || tier.priceCents < 0) {
        throw new DomainError('VALIDATION', 'tier priceCents must be a non-negative whole number');
      }
      return tier.priceCents;
    });
  }
  if (summary.cheapestPriceCents === undefined || summary.cheapestPriceCents === null) {
    return [];
  }
  if (!Number.isInteger(summary.cheapestPriceCents) || summary.cheapestPriceCents < 0) {
    throw new DomainError('VALIDATION', 'cheapestPriceCents must be a non-negative whole number');
  }
  return [summary.cheapestPriceCents];
}

function cheapestPrice(summary) {
  const prices = getTierPrices(summary);
  if (prices.length === 0) return undefined;
  return Math.min(...prices);
}

function availableSeats(summary) {
  if (Array.isArray(summary.tiers)) {
    return summary.tiers.reduce((total, tier) => {
      if (
        !Number.isInteger(tier.capacity) ||
        !Number.isInteger(tier.sold) ||
        !Number.isInteger(tier.reserved ?? 0) ||
        tier.capacity < 0 ||
        tier.sold < 0 ||
        (tier.reserved ?? 0) < 0
      ) {
        throw new DomainError('VALIDATION', 'tier inventory must use non-negative whole numbers');
      }
      return total + Math.max(0, tier.capacity - tier.sold - (tier.reserved ?? 0));
    }, 0);
  }
  if (summary.availableSeats === undefined) return 0;
  if (!Number.isInteger(summary.availableSeats) || summary.availableSeats < 0) {
    throw new DomainError('VALIDATION', 'availableSeats must be a non-negative whole number');
  }
  return summary.availableSeats;
}

function compareText(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareTitleAndId(left, right) {
  return compareText(left.title, right.title) || compareText(left.id, right.id);
}

export function filterEvents(summaries, criteria = {}) {
  requireSummaries(summaries);
  requireCriteria(criteria);

  const query = requireTextOption(criteria.q, 'q');
  const city = requireTextOption(criteria.city, 'city');
  const from = criteria.from === undefined ? undefined : parseIsoDate(criteria.from, 'from');
  const to =
    criteria.to === undefined ? undefined : parseIsoDate(criteria.to, 'to', true);
  if (from !== undefined && to !== undefined && from > to) {
    throw new DomainError('VALIDATION', 'from must not be after to');
  }

  const maxPriceCents = criteria.maxPriceCents;
  if (
    maxPriceCents !== undefined &&
    (!Number.isInteger(maxPriceCents) || maxPriceCents < 0)
  ) {
    throw new DomainError('VALIDATION', 'maxPriceCents must be a non-negative whole number');
  }
  if (criteria.onlyAvailable !== undefined && typeof criteria.onlyAvailable !== 'boolean') {
    throw new DomainError('VALIDATION', 'onlyAvailable must be a boolean');
  }

  return summaries.filter((summary) => {
    if (query) {
      const title = requireTextOption(summary.title, 'event title') ?? '';
      const venue = requireTextOption(summary.venue, 'event venue') ?? '';
      if (!title.includes(query) && !venue.includes(query)) return false;
    }

    if (city) {
      const eventCity = requireTextOption(summary.city, 'event city') ?? '';
      if (eventCity !== city) return false;
    }

    if (from !== undefined || to !== undefined) {
      const startsAt = parseIsoDate(summary.startsAt, 'event startsAt');
      if (from !== undefined && startsAt < from) return false;
      if (to !== undefined && startsAt > to) return false;
    }

    if (maxPriceCents !== undefined) {
      const price = cheapestPrice(summary);
      if (price === undefined || price > maxPriceCents) return false;
    }

    if (criteria.onlyAvailable && availableSeats(summary) <= 0) return false;
    return true;
  });
}

export function sortEvents(summaries, sortBy) {
  requireSummaries(summaries);
  if (!['date', 'price', 'availability'].includes(sortBy)) {
    throw new DomainError('VALIDATION', `unknown sort option: ${sortBy}`);
  }

  const compare = (left, right) => {
    let order = 0;
    if (sortBy === 'date') {
      order =
        parseIsoDate(left.startsAt, 'event startsAt') -
        parseIsoDate(right.startsAt, 'event startsAt');
    } else if (sortBy === 'price') {
      const leftPrice = cheapestPrice(left);
      const rightPrice = cheapestPrice(right);
      if (leftPrice === undefined && rightPrice !== undefined) order = 1;
      else if (leftPrice !== undefined && rightPrice === undefined) order = -1;
      else if (leftPrice !== undefined && rightPrice !== undefined) order = leftPrice - rightPrice;
    } else {
      order = availableSeats(right) - availableSeats(left);
    }
    return order || compareTitleAndId(left, right);
  };

  return mergeSort(summaries, compare);
}

export function searchEvents(summaries, criteria, sortBy) {
  return sortEvents(filterEvents(summaries, criteria), sortBy);
}
