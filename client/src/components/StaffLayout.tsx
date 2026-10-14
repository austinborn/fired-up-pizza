import { Link, NavLink, Outlet } from 'react-router-dom';
import { navLinkClass } from './nav-link-class';

/**
 * Shell for every /staff/* page (ADR 0006 rule 3, ADR 0007). Visually distinct
 * from the customer site so staff always know which side they are on.
 */
export function StaffLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-stone-100 text-stone-900">
      <header className="bg-stone-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-lg font-semibold">
            Fired Up Pizza <span className="font-normal text-stone-400">· Staff</span>
          </p>
          <nav aria-label="Staff">
            <ul className="flex gap-1 rounded-lg bg-white p-1">
              <li>
                <NavLink to="/staff/orders" className={navLinkClass}>
                  Orders
                </NavLink>
              </li>
              <li>
                <NavLink to="/staff/menu" className={navLinkClass}>
                  Menu
                </NavLink>
              </li>
            </ul>
          </nav>
          <Link to="/" className="text-sm text-stone-300 hover:text-white">
            Customer site
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
