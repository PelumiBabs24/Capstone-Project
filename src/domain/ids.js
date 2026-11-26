import { randomBytes, randomUUID } from 'node:crypto';
import { DomainError } from './errors.js';

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newId() {
  return randomUUID();
}

export function newReference(length = 8) {
  if (!Number.isInteger(length) || length < 1) {
    throw new DomainError('VALIDATION', 'Reference length must be a positive whole number');
  }

  const bytes = randomBytes(length);
  let reference = '';
  for (const byte of bytes) {
    reference += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  }
  return reference;
}
