// @vitest-environment happy-dom
import { act, fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeletionFlow } from '../../src/components/forms/DeletionFlow.tsx';
import { SupportForm } from '../../src/components/forms/SupportForm.tsx';
import { renderWithIntl } from './render.tsx';

// The client env is read once at import time, so the API base is set before any import runs.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
});

vi.mock('@/i18n/navigation.ts', () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string | { pathname: string };
    children: ReactNode;
  }) => (
    <a href={typeof href === 'string' ? href : href.pathname} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('SupportForm (W-SUP-01)', () => {
  it('lists every error in a summary and marks the fields invalid, without calling the API', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    renderWithIntl(
      <SupportForm initialCategory={null} turnstileSiteKey={undefined} nonce={undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Gönder' }));
    const summary = screen.getByRole('alert');
    expect(summary.textContent).toContain('E-posta adresini yaz.');
    expect(summary.textContent).toContain('Bir konu seç.');
    expect(summary.textContent).toContain('Mesajın en az 10 karakter olmalı.');
    expect(screen.getByLabelText('E-posta adresin').getAttribute('aria-invalid')).toBe('true');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preselects the category and shows the deletion hint for privacy', () => {
    renderWithIntl(
      <SupportForm initialCategory="privacy" turnstileSiteKey={undefined} nonce={undefined} />,
    );
    expect(screen.getByLabelText<HTMLSelectElement>('Konu').value).toBe('privacy');
    expect(screen.getByTestId('privacy-hint').querySelector('a')?.getAttribute('href')).toBe(
      '/data-deletion',
    );
  });

  it('counts characters against the 5000 limit', () => {
    renderWithIntl(
      <SupportForm initialCategory={null} turnstileSiteKey={undefined} nonce={undefined} />,
    );
    fireEvent.change(screen.getByLabelText('Mesajın'), { target: { value: 'Merhaba dünya' } });
    expect(screen.getByText('13/5000')).toBeTruthy();
  });
});

describe('DeletionFlow (W-DEL-01)', () => {
  it('keeps "Hesabımı sil" disabled until the code and the typed confirmation are valid', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(jsonResponse(202, { data: { status: 'code_sent_if_account_exists' } })),
    );
    vi.stubGlobal('fetch', fetch);
    renderWithIntl(<DeletionFlow turnstileSiteKey={undefined} nonce={undefined} />);
    fireEvent.change(screen.getByLabelText('Hesabındaki e-posta adresi'), {
      target: { value: 'yunus@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Kod gönder' }));
      await Promise.resolve();
    });
    const submit = await screen.findByRole('button', { name: 'Hesabımı sil' });
    expect(fetch).toHaveBeenCalledWith(
      'https://project.supabase.co/functions/v1/public-api/data-deletion/start',
      expect.objectContaining({ method: 'POST', credentials: 'omit' }),
    );
    expect(submit).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('6 haneli kod'), { target: { value: '12a3456' } });
    expect(screen.getByLabelText<HTMLInputElement>('6 haneli kod').value).toBe('123456');
    fireEvent.change(screen.getByLabelText('Onaylamak için SİL yaz'), { target: { value: 'sl' } });
    expect(submit).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Onaylamak için SİL yaz'), { target: { value: 'sil' } });
    expect(submit).toHaveProperty('disabled', false);
  });
});
