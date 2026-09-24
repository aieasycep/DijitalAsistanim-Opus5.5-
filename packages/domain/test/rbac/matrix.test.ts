import { describe, expect, it } from 'vitest';
import { ADMIN_ROLE_VALUES, type AdminRole } from '../../src/enums.ts';
import {
  ADMIN_GUARD_RULES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  can,
  canGrantEntitlement,
  canRequestSupportAccess,
  canWriteFlag,
  checkAdminChange,
  isAdminPermission,
  permissionKind,
  permissionsFor,
  rolePermissionPairs,
  type AdminPermission,
  type AdminRow,
} from '../../src/rbac.ts';
import { markdownSection, markdownTable, readRepoFile } from './doc-sources.ts';

describe('permission catalogue (BACKOFFICE_PLAN §4.1, T-1.14)', () => {
  it('equals the T-1.14 list verbatim, in order', () => {
    const section = markdownSection(readRepoFile('docs/IMPLEMENTATION_PLAN.md'), /^#### T-1\.14 /);
    const line = section.split('\n').find((l) => l.includes('The permission catalogue is')) ?? '';
    const listed = [...line.matchAll(/`([a-z_.]+)`/g)].map((m) => m[1]);
    expect(PERMISSIONS).toEqual(listed);
  });

  it('equals the BACKOFFICE_PLAN §4.1 table', () => {
    const section = markdownSection(readRepoFile('docs/BACKOFFICE_PLAN.md'), /^### 4\.1 /);
    const rows = markdownTable(section, (cells) => cells[0] === 'Permission');
    const documented = rows
      .slice(1)
      .flatMap((row) => (row[0] ?? '').match(/[a-z_]+(?:\.[a-z_]+){1,2}/g) ?? []);
    expect([...documented].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('has unique strings accepted by the admin_role_permissions check constraint', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const permission of PERMISSIONS) {
      expect(permission).toMatch(/^[a-z_]+(\.[a-z_]+){1,2}$/);
    }
  });

  it.each([
    ['dashboard.read', 'read'],
    ['search.global', 'read'],
    ['users.pii.reveal', 'reveal'],
    ['ai_feedback.reveal', 'reveal'],
    ['users.force_sync', 'mutation'],
    ['push.test', 'mutation'],
    ['support.access', 'mutation'],
    ['health.run', 'mutation'],
    ['settings.system.write', 'mutation'],
  ] as const)('%s is a %s permission', (permission, kind) => {
    expect(permissionKind(permission)).toBe(kind);
  });
});

describe('role matrix (BACKOFFICE_PLAN §4.2)', () => {
  it('defines every admin role and super_admin holds every permission', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ADMIN_ROLE_VALUES].sort());
    expect(permissionsFor('super_admin')).toEqual(PERMISSIONS);
  });

  it('lists only catalogue permissions, without duplicates', () => {
    for (const role of ADMIN_ROLE_VALUES) {
      const list = ROLE_PERMISSIONS[role];
      expect(new Set(list).size, role).toBe(list.length);
      for (const permission of list) expect(isAdminPermission(permission), permission).toBe(true);
    }
  });

  it.each(['analyst', 'readonly'] as const)(
    '%s has read permissions only (no mutation, no reveal)',
    (role) => {
      const notRead = ROLE_PERMISSIONS[role].filter((p) => permissionKind(p) !== 'read');
      expect(notRead).toEqual([]);
    },
  );

  const cases: [AdminRole, AdminPermission, boolean][] = [
    // UT-RBAC-04 spot rules
    ['operations', 'metrics.revenue.read', false],
    ['operations', 'billing_events.read', false],
    ['support', 'entitlements.grant_limited', true],
    ['support', 'entitlements.grant', false],
    ['analyst', 'users.read', false],
    ['analyst', 'metrics.revenue.read', true],
    ['readonly', 'users.read', true],
    ['readonly', 'users.pii.reveal', false],
    // R-09 Support Access only for support and super_admin
    ['support', 'support.access', true],
    ['super_admin', 'support.access', true],
    ['operations', 'support.access', false],
    ['finance', 'support.access', false],
    // push.test is SA and OP only (BACKOFFICE_PLAN §4.2, API_CONTRACTS ADM-07)
    ['operations', 'push.test', true],
    ['support', 'push.test', false],
    // finance: revenue and grants; ai_ops: AI surfaces
    ['finance', 'entitlements.grant', true],
    ['finance', 'referrals.review', true],
    ['finance', 'integrations.read', false],
    ['ai_ops', 'prompts.activate', true],
    ['ai_ops', 'flags.write', false],
    ['ai_ops', 'flags.write_ai', true],
    ['operations', 'flags.write_ai', true],
    ['operations', 'admins.manage', false],
    ['super_admin', 'admins.manage', true],
  ];
  it.each(cases)('can(%s, %s) = %s', (role, permission, expected) => {
    expect(can(role, permission)).toBe(expected);
  });

  it('never grants an unknown permission string', () => {
    for (const role of ADMIN_ROLE_VALUES) {
      expect(can(role, 'users.delete')).toBe(false);
      expect(can(role, '')).toBe(false);
    }
  });

  it('rolePermissionPairs covers the matrix once per pair', () => {
    const pairs = rolePermissionPairs();
    const total = ADMIN_ROLE_VALUES.reduce((sum, role) => sum + ROLE_PERMISSIONS[role].length, 0);
    expect(pairs).toHaveLength(total);
    expect(new Set(pairs.map((p) => `${p.role}:${p.permission}`)).size).toBe(total);
  });
});

describe('argument-dependent rules (BACKOFFICE_PLAN §4.3)', () => {
  it.each([
    ['finance', 'admin', 30, true],
    ['finance', 'compensation', 14, true],
    ['finance', 'admin', 3, false],
    ['finance', 'referral_referee', 14, false],
    ['support', 'support', 7, true],
    ['support', 'support', 1, true],
    ['support', 'support', 14, false],
    ['support', 'admin', 7, false],
    ['operations', 'admin', 7, false],
    ['super_admin', 'support', 30, true],
    ['readonly', 'support', 1, false],
  ] as const)('canGrantEntitlement(%s, %s, %i days) = %s', (role, source, days, expected) => {
    expect(canGrantEntitlement(role, { source, days })).toBe(expected);
  });

  it.each([
    ['ai_ops', 'ai.global.enabled', true],
    ['ai_ops', 'voice.tts_premium', true],
    ['ai_ops', 'feature.midday', false],
    ['operations', 'feature.midday', true],
    ['operations', 'ai.batch.enabled', true],
    ['support', 'ai.global.enabled', false],
    ['readonly', 'feature.capture', false],
  ] as const)('canWriteFlag(%s, %s) = %s', (role, key, expected) => {
    expect(canWriteFlag(role, key)).toBe(expected);
  });

  it('Support Access is limited to roles holding support.access', () => {
    const allowed = ADMIN_ROLE_VALUES.filter((role) => canRequestSupportAccess(role));
    expect(allowed.sort()).toEqual(['super_admin', 'support']);
  });
});

describe('last super_admin and self-protection (BACKOFFICE_PLAN §4.4)', () => {
  const admins: AdminRow[] = [
    { id: 'sa-1', role: 'super_admin', status: 'active' },
    { id: 'sa-2', role: 'super_admin', status: 'disabled' },
    { id: 'op-1', role: 'operations', status: 'active' },
  ];
  const twoSuperAdmins: AdminRow[] = [
    ...admins,
    { id: 'sa-3', role: 'super_admin', status: 'active' },
  ];

  it.each([
    [
      'demoting the last active super_admin',
      admins,
      'sa-1',
      { kind: 'update', role: 'operations' },
      'last_super_admin',
    ],
    [
      'disabling the last active super_admin',
      admins,
      'sa-1',
      { kind: 'update', status: 'disabled' },
      'last_super_admin',
    ],
    [
      'demoting one of two active super_admins',
      twoSuperAdmins,
      'sa-1',
      { kind: 'update', role: 'finance' },
      null,
    ],
    [
      'an update that changes nothing',
      admins,
      'sa-1',
      { kind: 'update', role: 'super_admin' },
      null,
    ],
    ['disabling a non-super admin', admins, 'op-1', { kind: 'update', status: 'disabled' }, null],
    [
      're-enabling a disabled super_admin',
      admins,
      'sa-2',
      { kind: 'update', status: 'active' },
      null,
    ],
    ['deleting any admin', twoSuperAdmins, 'op-1', { kind: 'delete' }, 'admins_never_deleted'],
    ['resetting MFA of another admin', admins, 'op-1', { kind: 'mfa_reset' }, null],
  ] as const)('%s → %s', (_label, rows, targetId, change, expected) => {
    expect(checkAdminChange({ admins: rows, targetId, callerId: 'caller', change })).toBe(expected);
  });

  it.each([
    [{ kind: 'update', role: 'operations' }],
    [{ kind: 'update', status: 'disabled' }],
    [{ kind: 'mfa_reset' }],
  ] as const)('an admin cannot change their own role, status or MFA (%j)', (change) => {
    expect(
      checkAdminChange({ admins: twoSuperAdmins, targetId: 'sa-3', callerId: 'sa-3', change }),
    ).toBe('self_change_forbidden');
  });

  it('describes every guard rule', () => {
    expect(Object.keys(ADMIN_GUARD_RULES).sort()).toEqual([
      'admins_never_deleted',
      'last_super_admin',
      'self_change_forbidden',
    ]);
  });
});
