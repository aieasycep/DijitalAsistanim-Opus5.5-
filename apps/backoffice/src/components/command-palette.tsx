'use client';

import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { Icon, type IconName } from '@/components/icon';
import { useSessionActions } from '@/components/session-actions';
import { useSetTheme, useTheme, type Theme } from '@/components/theme-toggle';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { isBuiltPath, type NavGroup } from '@/lib/navigation';

/*
 * Command palette (BACKOFFICE_PLAN §6.25, M§69): ⌘K / Ctrl+K or the topbar "Ara… ⌘K".
 * - Pages: the admin's visible sidebar entries.
 * - Records: `GET /search` through the read proxy `/api/admin/search` (debounce 250 ms, min 3
 *   characters, masked labels only; `admin_api.command_search`), when the admin holds
 *   `search.global`. A result opens its detail page when that module exists, otherwise its ID is
 *   copied; nothing is ever executed from the palette.
 * - Commands: theme, "Çıkış yap" and "Tüm oturumlardan çık", each through its confirmation.
 */

export const SEARCH_MIN_CHARS = 3;
export const SEARCH_DEBOUNCE_MS = 250;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SearchResult {
  readonly type: 'user' | 'job' | 'ticket' | 'subscription' | 'referral' | 'integration';
  readonly id: string;
  readonly label: string;
  readonly route: string;
}

const TYPE_ICON: Readonly<Record<SearchResult['type'], IconName>> = {
  user: 'group',
  job: 'sync_alt',
  ticket: 'support_agent',
  subscription: 'workspace_premium',
  referral: 'redeem',
  integration: 'hub',
};

interface PaletteApi {
  open(): void;
}

const PaletteCtx = createContext<PaletteApi | null>(null);

export function usePalette(): PaletteApi {
  const api = useContext(PaletteCtx);
  if (api === null) throw new Error('usePalette must be used inside <CommandPaletteProvider>');
  return api;
}

type SearchResponse =
  | { readonly query: string; readonly kind: 'done'; readonly results: readonly SearchResult[] }
  | { readonly query: string; readonly kind: 'failed' };

type SearchView =
  | { kind: 'idle' }
  | { kind: 'short' }
  | { kind: 'loading' }
  | { kind: 'done'; results: readonly SearchResult[] }
  | { kind: 'failed' };

/** Whether a query is worth sending: ≥ 3 characters, or an exact uuid (§6.25). */
export function searchable(query: string): boolean {
  const q = query.trim();
  return q.length >= SEARCH_MIN_CHARS || UUID.test(q);
}

export function CommandPaletteProvider({
  groups,
  canSearch,
  theme: initialTheme,
  children,
}: {
  groups: readonly NavGroup[];
  canSearch: boolean;
  theme: Theme;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const api = useMemo<PaletteApi>(
    () => ({
      open: () => {
        setOpen(true);
      },
    }),
    [],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <PaletteCtx.Provider value={api}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
            <Palette
              groups={groups}
              canSearch={canSearch}
              initialTheme={initialTheme}
              onClose={() => {
                setOpen(false);
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </PaletteCtx.Provider>
  );
}

function Palette({
  groups,
  canSearch,
  initialTheme,
  onClose,
}: {
  groups: readonly NavGroup[];
  canSearch: boolean;
  initialTheme: Theme;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice');
  const router = useRouter();
  const toast = useToast();
  const session = useSessionActions();
  const theme = useTheme(initialTheme);
  const { setTheme } = useSetTheme();
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const q = query.trim();
  const mode = !canSearch || q === '' ? 'idle' : searchable(q) ? 'search' : 'short';

  useEffect(() => {
    if (mode !== 'search') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/admin/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const body = (await res.json()) as { results?: SearchResult[] };
          setResponse({ query: q, kind: 'done', results: body.results ?? [] });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setResponse({ query: q, kind: 'failed' });
          return error;
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [mode, q]);

  const search: SearchView =
    mode === 'idle'
      ? { kind: 'idle' }
      : mode === 'short'
        ? { kind: 'short' }
        : response?.query !== q
          ? { kind: 'loading' }
          : response.kind === 'done'
            ? { kind: 'done', results: response.results }
            : { kind: 'failed' };

  const normalized = query.trim().toLocaleLowerCase();
  const matches = useCallback(
    (label: string) => normalized === '' || label.toLocaleLowerCase().includes(normalized),
    [normalized],
  );

  const pages = groups.flatMap((group) =>
    group.items
      .map((item) => ({ item, label: t(`nav.items.${item.key}`) }))
      .filter(({ label }) => matches(label)),
  );
  const commands: { id: string; icon: IconName; label: string; run: () => void }[] = [
    {
      id: 'theme',
      icon: theme === 'dark' ? 'light_mode' : 'dark_mode',
      label: theme === 'dark' ? t('palette.themeLight') : t('palette.themeDark'),
      run: () => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
      },
    },
    {
      id: 'logout',
      icon: 'logout',
      label: t('palette.logout'),
      run: () => {
        session.confirmLogout();
      },
    },
    {
      id: 'logout-all',
      icon: 'logout',
      label: t('palette.logoutAll'),
      run: () => {
        session.confirmLogoutAll();
      },
    },
  ];
  const visibleCommands = commands.filter((command) => matches(command.label));

  async function openResult(result: SearchResult) {
    if (isBuiltPath(result.route)) {
      onClose();
      router.push(result.route);
      return;
    }
    try {
      await navigator.clipboard.writeText(result.id);
      toast.show(t('palette.idCopied'));
    } catch {
      toast.show(result.id);
    }
    onClose();
  }

  const itemClass =
    'flex min-h-10 cursor-default items-center gap-3 rounded-[8px] px-3 text-bo-body text-ink outline-none select-none data-[selected=true]:bg-surface-pressed';

  return (
    <Command label={t('palette.title')} shouldFilter={false} loop className="flex flex-col">
      <DialogTitle className="sr-only">{t('palette.title')}</DialogTitle>
      <DialogDescription className="sr-only">{t('palette.description')}</DialogDescription>
      <div className="flex items-center gap-2 border-b border-border-hairline px-4">
        <Icon name="search" className="text-ink-3" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder={t('palette.hint')}
          aria-label={t('palette.hint')}
          className="h-12 w-full bg-transparent text-bo-body text-ink outline-none placeholder:text-ink-3"
        />
      </div>
      <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
        {search.kind === 'short' ? (
          <p className="px-3 py-2 text-bo-meta text-ink-3" role="status">
            {t('palette.minChars')}
          </p>
        ) : null}
        {search.kind === 'loading' ? (
          <Command.Loading>
            <p className="px-3 py-2 text-bo-meta text-ink-3">{t('palette.searching')}</p>
          </Command.Loading>
        ) : null}
        {search.kind === 'failed' ? (
          <p className="px-3 py-2 text-bo-meta text-tone-critical-text" role="alert">
            {t('palette.failed')}
          </p>
        ) : null}
        {search.kind === 'done' && search.results.length > 0 ? (
          <Command.Group
            heading={t('palette.groups.results')}
            className="text-bo-kicker text-ink-3 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:uppercase"
          >
            {search.results.map((result) => (
              <Command.Item
                key={`${result.type}:${result.id}`}
                value={`result:${result.type}:${result.id}`}
                onSelect={() => {
                  void openResult(result);
                }}
                className={itemClass}
              >
                <Icon name={TYPE_ICON[result.type]} className="text-ink-3" />
                <span className="flex-1 truncate">{result.label}</span>
                <span className="text-bo-meta text-ink-3">
                  {isBuiltPath(result.route)
                    ? t(`palette.types.${result.type}`)
                    : t('palette.copyId')}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
        {pages.length > 0 ? (
          <Command.Group
            heading={t('palette.groups.navigation')}
            className="text-bo-kicker text-ink-3 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:uppercase"
          >
            {pages.map(({ item, label }) => (
              <Command.Item
                key={item.key}
                value={`page:${item.key}`}
                onSelect={() => {
                  onClose();
                  router.push(item.href);
                }}
                className={itemClass}
              >
                <Icon name={item.icon} className="text-ink-3" />
                {label}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
        {visibleCommands.length > 0 ? (
          <Command.Group
            heading={t('palette.groups.commands')}
            className="text-bo-kicker text-ink-3 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:uppercase"
          >
            {visibleCommands.map((command) => (
              <Command.Item
                key={command.id}
                value={`command:${command.id}`}
                onSelect={() => {
                  onClose();
                  command.run();
                }}
                className={itemClass}
              >
                <Icon name={command.icon} className="text-ink-3" />
                {command.label}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
        {pages.length === 0 &&
        visibleCommands.length === 0 &&
        (search.kind === 'done' ? search.results.length === 0 : search.kind === 'idle') ? (
          <Command.Empty className="px-3 py-6 text-center text-bo-body text-ink-2">
            {t('palette.empty')}
          </Command.Empty>
        ) : null}
      </Command.List>
    </Command>
  );
}
