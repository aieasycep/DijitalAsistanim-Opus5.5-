/**
 * Dependencies of the AI pipeline routes (API-MAIL-07, API-SRCH-01, API-BRF-02…04). Reads that
 * clients may make run with the caller's JWT (RLS; RPC-02 is `security invoker`); system reads and
 * writes are always filtered by the verified user id, never by an id from the request body.
 */
import type { RetentionPolicy } from '@da/domain';
import type { UserAuth } from '../../_shared/http/context.ts';
import type { ClientConfig, DbClient } from '../../_shared/db/clients.ts';
import { userClient } from '../../_shared/db/clients.ts';
import { DB_FN, rpc } from '../../_shared/db/functions.ts';
import { mapDbError } from '../../_shared/errors.ts';
import type { AiServices } from '../../_shared/services/ai/runtime.ts';
import type { MailBodySource, MailStore, MemoryStore } from '../../_shared/services/intel/store.ts';
import type { BriefingRow } from '../../_shared/services/intel/types.ts';
import type { SearchRow, SearchRpcArgs } from '../../_shared/services/memory/search.ts';

export interface SearchRepo {
  search(args: SearchRpcArgs): Promise<SearchRow[]>;
  contactsNamed(names: readonly string[]): Promise<{ id: string; display_name: string }[]>;
  ownsContact(contactId: string): Promise<boolean>;
  semanticQuota(): Promise<boolean>;
  retention(): Promise<{ policy: RetentionPolicy; oldest_available_at: string | null } | null>;
}

export interface BriefingApiRepo {
  byId(id: string): Promise<BriefingRow | null>;
  eveningReady(id: string, itemIds: readonly string[] | null): Promise<Record<string, unknown>>;
  retry(id: string): Promise<Record<string, unknown>>;
}

export interface IntelApi {
  readonly ai: AiServices;
  readonly bodies: MailBodySource | null;
  /** System mail store (callers check `user_id` against the verified user). */
  readonly mail: MailStore;
  readonly memory: MemoryStore;
  search(auth: UserAuth): SearchRepo;
  briefings(auth: UserAuth): BriefingApiRepo;
}

const RETENTION_DAYS: Readonly<Record<RetentionPolicy, number | null>> = {
  d30: 30,
  d90: 90,
  d365: 365,
  until_deleted: null,
};

export function supabaseIntelApi(input: {
  readonly system: DbClient;
  readonly config: ClientConfig;
  readonly ai: AiServices;
  readonly mail: MailStore;
  readonly memory: MemoryStore;
  readonly bodies: MailBodySource | null;
}): IntelApi {
  const { system, config } = input;
  return {
    ai: input.ai,
    bodies: input.bodies,
    mail: input.mail,
    memory: input.memory,
    search(auth) {
      const user = userClient(auth.jwt, config);
      return {
        async search(args) {
          return (await rpc<SearchRow[] | null>(user, DB_FN.searchUserContent, { ...args })) ?? [];
        },
        async contactsNamed(names) {
          if (names.length === 0) return [];
          const { data, error } = await user
            .from('contacts')
            .select('id,display_name')
            .is('merged_into_id', null)
            .or(names.map((n) => `display_name.ilike.${n.replace(/[,()%*]/g, '')}%`).join(','))
            .limit(5);
          if (error !== null) throw mapDbError(error);
          return (data ?? []) as { id: string; display_name: string }[];
        },
        async ownsContact(contactId) {
          const { data, error } = await user
            .from('contacts')
            .select('id')
            .eq('id', contactId)
            .maybeSingle();
          if (error !== null) throw mapDbError(error);
          return data !== null;
        },
        async semanticQuota() {
          const result = await rpc<{ allowed?: boolean } | null>(system, DB_FN.checkPlanLimit, {
            p_key: 'semantic_search_daily',
            p_increment: 1,
            p_user_id: auth.userId,
          });
          return result?.allowed === true;
        },
        async retention() {
          const { data, error } = await user
            .from('user_preferences')
            .select('retention_policy')
            .maybeSingle();
          if (error !== null) throw mapDbError(error);
          const policy = (data as { retention_policy?: RetentionPolicy } | null)?.retention_policy;
          if (policy === undefined || !(policy in RETENTION_DAYS)) return null;
          const days = RETENTION_DAYS[policy];
          return {
            policy,
            oldest_available_at:
              days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString(),
          };
        },
      };
    },
    briefings(auth) {
      return {
        async byId(id) {
          const { data, error } = await system
            .from('briefings')
            .select(
              'id,user_id,kind,local_date,time_zone,scheduled_for,status,generated_at,version,origin,idempotency_key,counts,weekly_stats,evening_ready_at',
            )
            .eq('id', id)
            .eq('user_id', auth.userId)
            .maybeSingle();
          if (error !== null) throw mapDbError(error);
          return (data as BriefingRow | null) ?? null;
        },
        eveningReady: (id, itemIds) =>
          rpc<Record<string, unknown>>(system, DB_FN.briefingEveningReady, {
            p_user: auth.userId,
            p_briefing_id: id,
            p_item_ids: itemIds === null ? null : [...itemIds],
          }),
        retry: (id) =>
          rpc<Record<string, unknown>>(system, DB_FN.briefingRetry, {
            p_user: auth.userId,
            p_briefing_id: id,
          }),
      };
    },
  };
}
