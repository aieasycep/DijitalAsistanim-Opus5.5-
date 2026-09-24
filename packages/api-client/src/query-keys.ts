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
    // T-8.18 Approval Center (M-APPR-01…03) and the capture batch (M-CAP-07).
    pending: () => ['approvals', 'pending'] as const,
    history: (filter: string) => ['approvals', 'history', filter] as const,
    events: (id: string) => ['approvals', id, 'events'] as const,
    batch: (batchId: string) => ['approvals', 'batch', batchId] as const,
  },
  // T-8.15 search and memory (never persisted, Part 3 §0.8).
  search: {
    all: ['search'] as const,
    results: (params: Readonly<Record<string, string>>) => ['search', 'results', params] as const,
    memory: (params: Readonly<Record<string, string>>) => ['search', 'memory', params] as const,
  },
  // T-8.16 person intelligence and VIPs.
  person: {
    all: ['person'] as const,
    detail: (contactId: string) => ['person', contactId] as const,
  },
  vip: {
    all: ['vip'] as const,
    list: () => ['vip', 'list'] as const,
    suggestions: () => ['vip', 'suggestions'] as const,
    picker: (term: string) => ['vip', 'picker', term] as const,
  },
  // T-8.17 captures.
  captures: {
    all: ['captures'] as const,
    detail: (id: string) => ['captures', 'detail', id] as const,
    recentLinks: () => ['captures', 'recent-links'] as const,
    attachments: () => ['captures', 'attachments'] as const,
  },
  // T-8.18 reminders.
  reminders: {
    all: ['reminders'] as const,
    forTarget: (targetType: string, targetId: string) =>
      ['reminders', 'target', targetType, targetId] as const,
  },
  insights: {
    all: ['insights'] as const,
    why: (id: string) => ['insights', id, 'why'] as const,
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
    thread: (threadId: string) => ['assistant', 'thread', threadId] as const,
    messages: (threadId: string) => ['assistant', 'messages', threadId] as const,
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
  integrations: {
    start: ['integrations', 'start'] as const,
    upgrade: ['integrations', 'upgrade'] as const,
    complete: ['integrations', 'oauth-complete'] as const,
    disconnect: ['integrations', 'disconnect'] as const,
    sync: ['integrations', 'sync'] as const,
    dataSources: ['integrations', 'data-sources'] as const,
    deviceSnapshot: ['integrations', 'device-snapshot'] as const,
  },
  onboarding: {
    firstAnalysis: ['onboarding', 'first-analysis'] as const,
  },
  // T-8.15…T-8.18: assistant, approvals, reminders and captures.
  assistant: {
    createThread: ['assistant', 'create-thread'] as const,
  },
  approvals: {
    propose: ['approvals', 'propose'] as const,
    edit: ['approvals', 'edit'] as const,
    approve: ['approvals', 'approve'] as const,
    reject: ['approvals', 'reject'] as const,
    deviceExecution: ['approvals', 'device-execution'] as const,
  },
  reminders: {
    resolveTime: ['reminders', 'resolve-time'] as const,
    create: ['reminders', 'create'] as const,
    cancel: ['reminders', 'cancel'] as const,
  },
  captures: {
    uploadUrl: ['captures', 'upload-url'] as const,
    create: ['captures', 'create'] as const,
    analyze: ['captures', 'analyze'] as const,
    actions: ['captures', 'actions'] as const,
    discard: ['captures', 'discard'] as const,
  },
  briefings: {
    eveningReady: ['briefings', 'evening-ready'] as const,
    retry: ['briefings', 'retry'] as const,
  },
} as const;
