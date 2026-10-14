import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from './test/render';

// Pages are stubbed so this file tests only the route table and layouts.
// Replacing a page with its real implementation never requires editing it.
vi.mock('./pages/customer/MenuPage', () => ({ MenuPage: () => 'menu page' }));
vi.mock('./pages/customer/PizzaBuilderPage', () => ({
  PizzaBuilderPage: () => 'pizza builder page',
}));
vi.mock('./pages/customer/CartPage', () => ({ CartPage: () => 'cart page' }));
vi.mock('./pages/customer/OrderConfirmationPage', () => ({
  OrderConfirmationPage: () => 'order confirmation page',
}));
vi.mock('./pages/customer/OrderTrackingPage', () => ({
  OrderTrackingPage: () => 'order tracking page',
}));
vi.mock('./pages/staff/StaffOrderQueuePage', () => ({
  StaffOrderQueuePage: () => 'staff order queue page',
}));
vi.mock('./pages/staff/StaffMenuPage', () => ({ StaffMenuPage: () => 'staff menu page' }));

describe('App routes', () => {
  it.each([
    ['/', 'menu page'],
    ['/menu/7', 'pizza builder page'],
    ['/cart', 'cart page'],
    ['/order-confirmation/12', 'order confirmation page'],
    ['/track', 'order tracking page'],
  ])('renders %s inside the customer layout', (route, page) => {
    renderApp(route);

    expect(screen.getByText(page)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Staff' })).not.toBeInTheDocument();
  });

  it.each([
    ['/staff/orders', 'staff order queue page'],
    ['/staff/menu', 'staff menu page'],
  ])('renders %s inside the staff layout', (route, page) => {
    renderApp(route);

    expect(screen.getByText(page)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Staff' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('redirects /staff to the order queue', () => {
    renderApp('/staff');

    expect(screen.getByText('staff order queue page')).toBeInTheDocument();
  });

  it('shows a not-found page with a way back for unknown routes', () => {
    renderApp('/no-such-page');

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the menu' })).toHaveAttribute('href', '/');
  });
});

describe('navigation', () => {
  it('links the customer header to every customer area and the footer to staff', () => {
    renderApp('/');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Menu' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Track order' })).toHaveAttribute(
      'href',
      '/track',
    );
    // Prefix match: the cart link may also announce its item count.
    expect(within(nav).getByRole('link', { name: /^Cart\b/ })).toHaveAttribute('href', '/cart');
    expect(screen.getByRole('link', { name: 'Staff' })).toHaveAttribute('href', '/staff');
  });

  it('marks the current customer page in the header', () => {
    renderApp('/track');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Track order' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Menu' })).not.toHaveAttribute('aria-current');
  });

  it('links the staff header to the queue, menu management, and back to the customer site', () => {
    renderApp('/staff/orders');

    const nav = screen.getByRole('navigation', { name: 'Staff' });
    expect(within(nav).getByRole('link', { name: 'Orders' })).toHaveAttribute(
      'href',
      '/staff/orders',
    );
    expect(within(nav).getByRole('link', { name: 'Menu' })).toHaveAttribute('href', '/staff/menu');
    expect(screen.getByRole('link', { name: 'Customer site' })).toHaveAttribute('href', '/');
  });
});
