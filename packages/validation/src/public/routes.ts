import { z } from 'zod';
import { defineRoute } from '../route.ts';
import {
  DataDeletionStartBody,
  DataDeletionStartResponse,
  DataDeletionVerifyBody,
  DataDeletionVerifyResponse,
  DeletionStatusParams,
  DeletionStatusQuery,
  DeletionStatusResponse,
  InboundEmailAck,
  InboundEmailBody,
  PublicPlansResponse,
  PublicReferralParams,
  PublicReferralResponse,
  PublicSupportBody,
  PublicSupportResponse,
  WebEventInput,
} from './schemas.ts';

/** The `public-api` route catalogue (`/functions/v1/public-api`, API_CONTRACTS §13). */
export const publicRoutes = {
  'POST /support': defineRoute({
    id: 'PUB-01',
    method: 'POST',
    path: '/support',
    request: { body: PublicSupportBody },
    response: PublicSupportResponse,
    status: 202,
    idempotency: 'natural',
  }),
  'POST /data-deletion/start': defineRoute({
    id: 'PUB-02',
    method: 'POST',
    path: '/data-deletion/start',
    request: { body: DataDeletionStartBody },
    response: DataDeletionStartResponse,
    status: 202,
    idempotency: 'none',
  }),
  'POST /data-deletion/verify': defineRoute({
    id: 'PUB-03',
    method: 'POST',
    path: '/data-deletion/verify',
    request: { body: DataDeletionVerifyBody },
    response: DataDeletionVerifyResponse,
    status: 202,
    idempotency: 'natural',
  }),
  'GET /referrals/:code': defineRoute({
    id: 'PUB-04',
    method: 'GET',
    path: '/referrals/:code',
    request: { params: PublicReferralParams },
    response: PublicReferralResponse,
    status: 200,
    idempotency: 'none',
  }),
  'GET /plans': defineRoute({
    id: 'PUB-05',
    method: 'GET',
    path: '/plans',
    request: {},
    response: PublicPlansResponse,
    status: 200,
    idempotency: 'none',
  }),
  'POST /web-events': defineRoute({
    id: 'PUB-06',
    method: 'POST',
    path: '/web-events',
    request: { body: WebEventInput },
    response: z.undefined(),
    status: 204,
    idempotency: 'none',
  }),
  'GET /data-deletion/:requestId/status': defineRoute({
    id: 'PUB-07',
    method: 'GET',
    path: '/data-deletion/:requestId/status',
    request: { params: DeletionStatusParams, query: DeletionStatusQuery },
    response: DeletionStatusResponse,
    status: 200,
    idempotency: 'none',
  }),
  'POST /support/inbound-email': defineRoute({
    id: 'PUB-08',
    method: 'POST',
    path: '/support/inbound-email',
    request: { body: InboundEmailBody },
    response: InboundEmailAck,
    status: 200,
    idempotency: 'natural',
  }),
} as const;

export type PublicRoutes = typeof publicRoutes;
export type PublicRouteKey = keyof PublicRoutes;
