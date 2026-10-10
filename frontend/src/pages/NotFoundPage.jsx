import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <section className="welcome-card">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <Link to="/">Return to the home page</Link>
    </section>
  );
}
