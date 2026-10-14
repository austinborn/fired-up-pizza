import type { z } from 'zod';
import { AppError } from './errors';

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Parses untrusted input (body, query, params) with a zod schema (ADR 0006).
 * Object schemas strip unknown keys by default, so stray fields such as
 * client-sent prices never reach services. Failures become a 400
 * VALIDATION_ERROR listing each issue.
 */
export function parseWith<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
    throw new AppError('VALIDATION_ERROR', 'Request validation failed', { issues });
  }
  return result.data;
}
