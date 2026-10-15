import {
  apiErrorIssues,
  type ApiErrorIssue,
  type MenuItem,
  type Topping,
} from '@fired-up-pizza/shared';
import type {
  CreateMenuItemRequest,
  CreateToppingRequest,
  UpdateMenuItemRequest,
  UpdateToppingRequest,
} from '@fired-up-pizza/shared/staff-catalog-api';
import { ApiError, getJson, patchJson, postJson, type RequestOptions } from './http';

// Staff menu management (ADR 0006 rule 2) for /staff/menu. The request types
// and field limits are in @fired-up-pizza/shared/staff-catalog-api. Unlike the
// customer catalog, the lists include hidden rows. Nothing is ever deleted:
// hiding is an update with `available: false`. Pass the AbortSignal that
// useAsync provides as `signal` when loading a list.

/** Every menu item, hidden ones included, ordered by category, then name, ignoring case. */
export function getStaffMenuItems(options?: RequestOptions): Promise<MenuItem[]> {
  return getJson<MenuItem[]>('/api/staff/menu-items', options);
}

/** Creates a menu item, available unless the request says otherwise, and resolves with it. */
export function createMenuItem(
  request: CreateMenuItemRequest,
  options?: RequestOptions,
): Promise<MenuItem> {
  return postJson<MenuItem>('/api/staff/menu-items', request, options);
}

/** Changes the fields in `changes`, keeping the rest, and resolves with the whole menu item. */
export function updateMenuItem(
  id: number,
  changes: UpdateMenuItemRequest,
  options?: RequestOptions,
): Promise<MenuItem> {
  return patchJson<MenuItem>(`/api/staff/menu-items/${id}`, changes, options);
}

/** Every topping, hidden ones included, ordered by name, ignoring case. */
export function getStaffToppings(options?: RequestOptions): Promise<Topping[]> {
  return getJson<Topping[]>('/api/staff/toppings', options);
}

/** Creates a topping, available unless the request says otherwise, and resolves with it. */
export function createTopping(
  request: CreateToppingRequest,
  options?: RequestOptions,
): Promise<Topping> {
  return postJson<Topping>('/api/staff/toppings', request, options);
}

/** Changes the fields in `changes`, keeping the rest, and resolves with the whole topping. */
export function updateTopping(
  id: number,
  changes: UpdateToppingRequest,
  options?: RequestOptions,
): Promise<Topping> {
  return patchJson<Topping>(`/api/staff/toppings/${id}`, changes, options);
}

/**
 * A problem with one request field, e.g. `{ path: 'name', message: 'Name is
 * required' }`, where `path` is the field's name, such as "basePriceCents".
 * The shape belongs to the shared error contract.
 */
export type FieldIssue = ApiErrorIssue;

/**
 * The per-field problems a failed create or update reports, so a form can show
 * each one next to its field: the `details.issues` of a 400 VALIDATION_ERROR,
 * or of a 409 CONFLICT, which the server sends in the same shape when the name
 * is taken. Empty for any other failure, and for details in any other shape.
 */
export function fieldIssues(error: unknown): FieldIssue[] {
  if (
    !(error instanceof ApiError) ||
    (error.code !== 'VALIDATION_ERROR' && error.code !== 'CONFLICT')
  ) {
    return [];
  }
  return apiErrorIssues(error.details);
}
