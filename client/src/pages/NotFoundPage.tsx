import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="text-stone-600">We couldn&apos;t find that page.</p>
      <Link to="/" className="font-medium text-orange-700 hover:underline">
        Back to the menu
      </Link>
    </section>
  );
}
