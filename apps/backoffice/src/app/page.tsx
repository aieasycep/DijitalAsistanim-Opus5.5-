import { redirect } from 'next/navigation';

/** `/` → the dashboard (BACKOFFICE_PLAN §2.2); the proxy sends signed-out visitors to /login first. */
export default function Home(): never {
  redirect('/dashboard');
}
