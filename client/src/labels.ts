import type { Tab } from '@shared/types';

export const TAB_TEXT: Record<Tab, { label: string; heading: string; hint: string }> = {
  poker: {
    label: 'Poker',
    heading: 'Provide an effort estimate - choose one of the cards',
    hint: 'Each team member should estimate the complexity of the task (user story) to be completed.',
  },
  confidence: {
    label: 'Confidence',
    heading: 'Confidence vote - choose one of the cards',
    hint: 'Pick the card that matches how confident you are. A higher number means more confidence.',
  },
};
