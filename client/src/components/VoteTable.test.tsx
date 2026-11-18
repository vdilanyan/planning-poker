// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Row } from '@shared/types';
import { VoteTable } from './VoteTable';

const hiddenRows: Row[] = [
  { id: 'row-0001', name: 'Ada', hasVoted: true, online: true },
  { id: 'row-0002', name: 'Bob', hasVoted: false, online: true },
];
const revealedRows: Row[] = [
  { id: 'row-0001', name: 'Ada', hasVoted: true, online: true, value: 8 },
  { id: 'row-0002', name: 'Bob', hasVoted: false, online: true },
];

const flipOf = (container: HTMLElement) => container.querySelector('.flip') as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('VoteTable mini cards', () => {
  it('shows a face-down card with no number while hidden, and a dashed card for non-voters', () => {
    const { container } = render(<VoteTable rows={hiddenRows} revealed={false} />);
    expect(screen.getByLabelText('Voted')).toBeTruthy();
    expect(screen.getByLabelText('Not voted')).toBeTruthy();
    expect(flipOf(container).classList.contains('flip--revealed')).toBe(false);
    expect(container.textContent).not.toContain('8');
  });

  it('flips the same card element when revealed and shows the number', () => {
    const { container, rerender } = render(<VoteTable rows={hiddenRows} revealed={false} />);
    const before = flipOf(container);

    rerender(<VoteTable rows={revealedRows} revealed />);

    expect(flipOf(container)).toBe(before);
    expect(before.classList.contains('flip--revealed')).toBe(true);
    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.queryByLabelText('Voted')).toBeNull();
  });

  it('keeps the number during the flip back, then removes it from the DOM', () => {
    const { container, rerender } = render(<VoteTable rows={revealedRows} revealed />);
    const card = flipOf(container);

    rerender(<VoteTable rows={hiddenRows} revealed={false} />);

    expect(flipOf(container)).toBe(card);
    expect(card.classList.contains('flip--revealed')).toBe(false);
    expect(container.textContent).toContain('8');

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(container.textContent).not.toContain('8');
    expect(screen.getByLabelText('Voted')).toBeTruthy();
  });

  it('renders already-revealed votes flipped from the start', () => {
    const { container } = render(<VoteTable rows={revealedRows} revealed />);
    expect(flipOf(container).classList.contains('flip--revealed')).toBe(true);
    expect(screen.getByText('8')).toBeTruthy();
  });
});
