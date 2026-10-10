import type { Platform } from '@bc/shared';

/** Made-up saves for the landing and sign-in pages. */
export interface Sample {
  id: string;
  platform: Platform;
  url: string;
  title: string;
  byline: string;
  kind: string;
  age: string;
  summary: string;
  topics: string[];
}

export const SAMPLES: Sample[] = [
  {
    id: 'yt',
    platform: 'youtube',
    url: 'https://www.youtube.com/watch?v=sample',
    title: 'Typography for interfaces, explained in twenty minutes',
    byline: 'Interface Notes',
    kind: 'Video',
    age: '1d',
    summary: 'Type scales, line length, and why tabular figures matter in tables and lists.',
    topics: ['design', 'typography'],
  },
  {
    id: 'x',
    platform: 'x',
    url: 'https://x.com/dbweekly/status/1',
    title: 'How we cut our Postgres p99 from 800 ms to 40 ms',
    byline: '@dbweekly',
    kind: 'Thread',
    age: '3h',
    summary:
      'Finds slow queries with pg_stat_statements, adds a partial index, moves a hot counter.',
    topics: ['postgres', 'performance'],
  },
  {
    id: 'reddit',
    platform: 'reddit',
    url: 'https://www.reddit.com/r/vscode/comments/1',
    title: 'Which VS Code setting could you not live without?',
    byline: 'r/vscode',
    kind: 'Discussion',
    age: '2d',
    summary: 'Top answers: format on save, sticky scroll, bracket pair guides, no minimap.',
    topics: ['vscode', 'tools'],
  },
  {
    id: 'mdn',
    platform: 'browser',
    url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries',
    title: 'CSS container queries',
    byline: 'developer.mozilla.org',
    kind: 'Reference',
    age: '5d',
    summary: 'Style components by the size of their container instead of the whole viewport.',
    topics: ['css', 'frontend'],
  },
  {
    id: 'ig',
    platform: 'instagram',
    url: 'https://www.instagram.com/p/sample/',
    title: 'Five-minute tomato sauce',
    byline: '@pastaathome',
    kind: 'Reel',
    age: '4d',
    summary: 'Garlic, olive oil, crushed tomatoes and basil, cooked hard and fast in a wide pan.',
    topics: ['cooking'],
  },
];
