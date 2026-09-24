import { redirect } from 'next/navigation';

import { userIdFrom } from './data';

/** `/users/[id]` → the overview tab (BACKOFFICE_PLAN §2.2). */
export default async function UserIndex({ params }: { params: Promise<{ id: string }> }) {
  const id = await userIdFrom(params);
  redirect(`/users/${id}/overview`);
}
