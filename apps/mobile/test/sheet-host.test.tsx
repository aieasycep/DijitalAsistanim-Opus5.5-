import { afterEach, describe, expect, it } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';
import {
  registerSheet,
  SheetHost,
  sheets,
  type SheetRenderProps,
} from '../src/providers/SheetHost';

function CounterSheet({ params }: SheetRenderProps<{ label: string }>) {
  const [count] = useState(1);
  const [suffix] = useState('!');
  return <Text>{`${params.label} ${String(count)}${suffix}`}</Text>;
}

function PlainSheet({ params }: SheetRenderProps<{ label: string }>) {
  const [value] = useState(params.label);
  return <Text>{value}</Text>;
}

describe('SheetHost', () => {
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    await act(() => {
      sheets.closeAll();
    });
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it('renders every sheet as its own component so stacked sheets keep separate hooks', async () => {
    cleanups.push(registerSheet('test.counter', CounterSheet));
    cleanups.push(registerSheet('test.plain', PlainSheet));
    await render(<SheetHost />);

    await act(() => {
      sheets.open('test.plain', { label: 'alt' });
    });
    await act(() => {
      sheets.open('test.counter', { label: 'üst' });
    });
    expect(screen.getByText('alt')).toBeTruthy();
    expect(screen.getByText('üst 1!')).toBeTruthy();

    // Changing the stack shape (a hook-using sheet on top closes) must not reorder hooks.
    await act(() => {
      sheets.close();
    });
    expect(screen.getByText('alt')).toBeTruthy();
  });
});
