import { connection } from 'next/server';
import { clientEnv } from '@/env/client.ts';
import { securityTxt } from '@/lib/well-known.ts';

/** W-SYS-06 · RFC 9116 `security.txt`; `Expires` is always a year ahead. */
export async function GET(): Promise<Response> {
  await connection();
  return new Response(securityTxt(clientEnv.NEXT_PUBLIC_SITE_URL, new Date()), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
