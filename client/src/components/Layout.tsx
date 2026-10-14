import { Link, NavLink, Outlet } from 'react-router-dom';
import { navLinkClass } from './nav-link-class';

/** Customer-facing shell: header navigation, page content, footer. */
export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="text-xl font-bold tracking-tight text-orange-700">
            <span aria-hidden="true">🔥 </span>Fired Up Pizza
          </Link>
          <nav aria-label="Main">
            <ul className="flex gap-1">
              <li>
                <NavLink to="/" end className={navLinkClass}>
                  Menu
                </NavLink>
              </li>
              <li>
                <NavLink to="/track" className={navLinkClass}>
                  Track order
                </NavLink>
              </li>
              <li>
                <NavLink to="/cart" className={navLinkClass}>
                  Cart
                </NavLink>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 text-sm text-stone-500">
          <p>Order online, pay at the counter.</p>
          <Link to="/staff" className="hover:text-stone-800">
            Staff
          </Link>
        </div>
      </footer>
    </div>
  );
}
