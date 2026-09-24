import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing.ts';

/** Locale-aware `Link`, `redirect`, `usePathname` and `getPathname` (`/pricing` ↔ `/en/pricing`). */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
