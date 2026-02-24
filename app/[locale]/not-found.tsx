import Link from 'next/link';

export default function NotFound() {
  return (
    <div>
      <h1>404 - Page Not Found</h1>
      <p>Could not find the requested resource.</p>
      <Link href="/">Return Home</Link>
    </div>
  );
}
