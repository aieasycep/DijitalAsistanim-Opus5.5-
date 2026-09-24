/** API-DEV-01 `POST /devices/register`, API-DEV-02 `POST /devices/unregister` (both [IK]). */
import { DeviceRegisterBody, DeviceUnregisterBody, routes } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { type JsonValue, withIdempotency } from '../../_shared/idempotency.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
} from '../../_shared/http/validate.ts';
import {
  registerDevice,
  type RegisterResult,
  unregisterDevice,
} from '../../_shared/services/devices.ts';
import type { RouteRegistrar } from '../deps.ts';

export const registerDeviceRoutes: RouteRegistrar = (app, kit) => {
  const register = routes['POST /devices/register'];
  mountRoute(
    app,
    register,
    ...kit.chain({ gate: true, rateLimit: 'devices_register' }),
    parseJsonBody(register),
    validateRequest(register),
    (c) => {
      const auth = currentUser(c);
      const body = validBody(c, DeviceRegisterBody);
      const repos = kit.deps.repos(auth);
      return withIdempotency(
        c,
        { repo: kit.deps.idempotency, now: () => kit.now().getTime() },
        {
          status: register.status,
          async execute() {
            const data = await registerDevice(
              repos.devices,
              kit.deps.env,
              auth.userId,
              body,
              kit.now(),
            );
            return {
              data,
              ref: { type: 'app_installation', id: body.installation_id, ack: { ...data } },
            };
          },
          replay: (ref) => Promise.resolve(ref.ack as unknown as RegisterResult),
        },
      );
    },
  );

  const unregister = routes['POST /devices/unregister'];
  mountRoute(
    app,
    unregister,
    // The account-state gate is skipped so a disabled account can still sign out (§3).
    ...kit.chain({ gate: false, rateLimit: 'api_default' }),
    parseJsonBody(unregister),
    validateRequest(unregister),
    (c) => {
      const auth = currentUser(c);
      const body = validBody(c, DeviceUnregisterBody);
      const repos = kit.deps.repos(auth);
      return withIdempotency(
        c,
        { repo: kit.deps.idempotency, now: () => kit.now().getTime() },
        {
          status: unregister.status,
          async execute() {
            const data = await unregisterDevice(repos.devices, auth.userId, body, kit.now());
            const ack: Record<string, JsonValue> = { ...data };
            return { data, ref: { type: 'app_installation', id: body.installation_id, ack } };
          },
          replay: (ref) =>
            Promise.resolve({ disabled_tokens: Number(ref.ack?.disabled_tokens ?? 0) }),
        },
      );
    },
  );
};
