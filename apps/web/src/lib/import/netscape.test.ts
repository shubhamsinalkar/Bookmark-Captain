// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseNetscapeBookmarks } from './netscape';

// Trimmed from a real Chrome export: note the unclosed <DT> and <p> tags.
const CHROME_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://example.com/a" ADD_DATE="1700000100">Article A</A>
        <DT><H3 ADD_DATE="1700000200">Dev</H3>
        <DL><p>
            <DT><A HREF="https://github.com/b" ADD_DATE="1700000300" ICON="data:image/png;base64,AAA">Repo B</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://example.org/top">  Top level  </A>
    <DT><A HREF="javascript:void(0)" ADD_DATE="0">Bookmarklet</A>
</DL><p>`;

describe('parseNetscapeBookmarks', () => {
  it('extracts URLs, titles, dates and folder paths', () => {
    expect(parseNetscapeBookmarks(CHROME_EXPORT)).toEqual([
      {
        platform: 'browser',
        url: 'https://example.com/a',
        title: 'Article A',
        savedAt: '2023-11-14T22:15:00.000Z',
        metadata: { folder: 'Bookmarks bar' },
      },
      {
        platform: 'browser',
        url: 'https://github.com/b',
        title: 'Repo B',
        savedAt: '2023-11-14T22:18:20.000Z',
        metadata: { folder: 'Bookmarks bar / Dev' },
      },
      { platform: 'browser', url: 'https://example.org/top', title: 'Top level' },
      // Kept here; the API reports it as rejected with a reason.
      { platform: 'browser', url: 'javascript:void(0)', title: 'Bookmarklet' },
    ]);
  });

  it('returns nothing for a file without bookmarks', () => {
    expect(parseNetscapeBookmarks('<html><body>Hello</body></html>')).toEqual([]);
  });
});
