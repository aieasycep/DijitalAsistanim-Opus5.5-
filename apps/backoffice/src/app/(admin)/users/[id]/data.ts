import 'server-only';

import { notFound } from 'next/navigation';
import { cache } from 'react';

import { UUID_PATTERN } from '@/lib/ids';
import { readAdmin } from '@/server/read';

/*
 * Reads shared by the user detail layout and its tabs, deduplicated per request with React
 * `cache` so the header, the Support Access banner and a tab never ask admin-api twice.
 */

export async function userIdFrom(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  return id.toLowerCase();
}

export const userOverview = cache((id: string) => readAdmin('GET /users/:id', { params: { id } }));

export const userSupport = cache((id: string) =>
  readAdmin('GET /users/:id/support', {
    params: { id },
    query: { page: 1, page_size: 25, order: 'desc' },
  }),
);

export const userDevices = cache((id: string) =>
  readAdmin('GET /users/:id/devices', { params: { id } }),
);

export const userSubscription = cache((id: string, grantsPage: number, eventsPage: number) =>
  readAdmin('GET /users/:id/subscription', {
    params: { id },
    query: { grants_page: grantsPage, events_page: eventsPage },
  }),
);
