/**
 * Hierarchical TanStack Query key factory `qk` (SCREEN_AND_FLOW_MAP §0.4 and Part 3 §0.8). Every
 * area has an `all` root so `invalidateQueries({queryKey: qk.<area>.all})` refreshes the area;
 * detail keys extend it. Keys are plain readonly tuples (no class instances), so they serialise into
 * the persisted cache. Mutation keys (`mk`) name `setMutationDefaults` entries for queued writes.
 */
export const qk = {
  me: {
    all: ['me'] as const,
    bootstrap: () => ['me', 'bootstrap'] as const,
    entitlements: () => ['me', 'entitlements'] as const,
  },
  integrations: {
    all: ['integrations'] as const,
    accounts: () => ['integrations', 'accounts'] as const,
  },
  onboarding: {
    all: ['onboarding'] as const,
    firstAnalysis: (jobId: string) => ['onboarding', 'first-analysis', jobId] as const,
  },
  contacts: {
    all: ['contacts'] as const,
    vipSuggestions: () => ['contacts', 'vip-suggestions'] as const,
  },
  today: {
    all: ['today'] as const,
    day: (localDate: string) => ['today', localDate] as const,
  },
  approvals: {
    all: ['approvals'] as const,
    pendingCount: () => ['approvals', 'pending-count'] as const,
    detail: (id: string) => ['approvals', id] as const,
    /** The polled `approval_actions` status row (R-19: polling, no Realtime). */
    status: (id: string) => ['approvals', id, 'status'] as const,
  },
  insights: {
    all: ['insights'] as const,
    why: (id: string) => ['insights', id, 'why'] as const,
  },
  flow: {
    all: ['flow'] as const,
    feed: (filter: string) => ['flow', filter] as const,
  },
  mail: {
    all: ['mail'] as const,
    intel: (localDate: string, account: string) => ['mail', 'intel', localDate, account] as const,
    category: (category: string, account: string) =>
      ['mail', 'category', category, account] as const,
    message: (id: string) => ['mail', 'message', id] as const,
    thread: (threadId: string) => ['mail', 'thread', threadId] as const,
    threadSummary: (threadId: string) => ['mail', 'thread-summary', threadId] as const,
    /** Raw original body: memory only, never persisted (SCREEN_AND_FLOW_MAP Part 2 §0.7). */
    original: (id: string) => ['mail', 'original', id] as const,
  },
  replyDrafts: {
    all: ['reply-drafts'] as const,
    detail: (id: string) => ['reply-drafts', id] as const,
    forMessage: (messageId: string) => ['reply-drafts', 'message', messageId] as const,
  },
  waiting: {
    all: ['waiting'] as const,
    list: () => ['waiting', 'list'] as const,
  },
  followups: {
    all: ['followups'] as const,
    list: () => ['followups', 'list'] as const,
  },
  commitments: {
    all: ['commitments'] as const,
    list: (direction: string) => ['commitments', 'list', direction] as const,
    proposals: () => ['commitments', 'proposals'] as const,
    detail: (id: string) => ['commitments', 'detail', id] as const,
  },
  life: {
    all: ['life'] as const,
    detail: (id: string) => ['life', id] as const,
  },
  plan: {
    all: ['plan'] as const,
    timeline: (fromIso: string, toIso: string) => ['plan', 'timeline', fromIso, toIso] as const,
    week: (weekStart: string) => ['plan', 'week', weekStart] as const,
    signals: (fromIso: string, toIso: string) => ['plan', 'signals', fromIso, toIso] as const,
    freeSlots: (fromIso: string, toIso: string, minMinutes: number) =>
      ['plan', 'free-slots', fromIso, toIso, minMinutes] as const,
    conflict: (insightId: string) => ['plan', 'conflict', insightId] as const,
  },
  events: {
    all: ['event'] as const,
    detail: (id: string) => ['event', id] as const,
  },
  meetings: {
    all: ['meeting'] as const,
    prep: (eventId: string) => ['meeting', 'prep', eventId] as const,
    notes: (eventId: string) => ['meeting', 'notes', eventId] as const,
  },
  briefings: {
    all: ['briefings'] as const,
    detail: (id: string) => ['briefings', id] as const,
    audio: (id: string) => ['briefings', id, 'audio'] as const,
    list: (cursor: string | null = null) => ['briefings', 'list', { cursor }] as const,
  },
  weekly: {
    all: ['weekly'] as const,
    detail: (id: string) => ['weekly', id] as const,
    shareCard: (id: string) => ['weekly', id, 'share-card'] as const,
  },
  referrals: {
    all: ['referrals'] as const,
    me: () => ['referrals', 'me'] as const,
  },
  assistant: {
    all: ['assistant'] as const,
    threads: () => ['assistant', 'threads'] as const,
  },
} as const;

export const mk = {
  devices: {
    register: ['devices', 'register'] as const,
    unregister: ['devices', 'unregister'] as const,
  },
  auth: {
    appleExchange: ['auth', 'apple-exchange'] as const,
  },
} as const;
