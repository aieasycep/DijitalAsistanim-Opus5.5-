import { notFound } from 'next/navigation';

/** Any unknown path under a locale renders the localized 404 (`[locale]/not-found.tsx`). */
export default function CatchAll(): never {
  notFound();
}
