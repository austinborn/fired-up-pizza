// The customer identity boundary (ADR 0005 rule 2). The MVP has no accounts: a
// customer is the phone number on their orders. This module is the swap point:
// moving to OTP or a magic link later means replacing it.
//
// Usage contract for routes:
//   1. Validate the request shape with parseWith and a zod schema that types the
//      phone as a plain string (phoneNumberField). Never check the number in zod.
//   2. Pass the parsed raw value to resolveCustomerIdentity and hand the
//      returned identity to services and repositories.
// An invalid phone therefore yields 400 INVALID_PHONE_NUMBER rather than the
// generic VALIDATION_ERROR. For example, the order lookup:
//   const { phone } = parseWith(z.object({ phone: phoneNumberField.optional() }), req.query);
//   const { phoneNumber } = resolveCustomerIdentity(phone);
//
// No other server module parses or normalizes phone numbers; they work with the
// E.164 phoneNumber resolved here. Phone numbers are personal data: never log
// them or put them in error messages (ADR 0005 rule 5).

import { normalizePhoneNumber } from '@fired-up-pizza/shared/phone';
import { z } from 'zod';
import { AppError } from '../http/errors';

/** The customer a request acts for. */
export interface CustomerIdentity {
  /** E.164 (`+1XXXXXXXXXX`), the form stored in and compared against `orders.phone_number`. */
  phoneNumber: string;
}

/**
 * The zod type for a phone field in a request schema. It checks shape only, so
 * resolveCustomerIdentity can report a bad number as INVALID_PHONE_NUMBER. Add
 * `.optional()` where a missing phone should get that code too, as in the
 * order lookup query.
 */
export const phoneNumberField = z.string();

/**
 * Resolves the customer behind a raw phone value from a request. Throws
 * AppError INVALID_PHONE_NUMBER (400) when the value is missing, is not a
 * string, or is not a phone number that shared/src/phone.ts accepts. The error
 * never repeats the input.
 */
export function resolveCustomerIdentity(rawPhone: unknown): CustomerIdentity {
  const phoneNumber = typeof rawPhone === 'string' ? normalizePhoneNumber(rawPhone) : null;
  if (phoneNumber === null) {
    throw new AppError(
      'INVALID_PHONE_NUMBER',
      'Phone number must be a valid 10-digit US or Canadian number',
    );
  }
  return { phoneNumber };
}
