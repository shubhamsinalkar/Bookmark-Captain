# Bookmark Captain — User Guide

Bookmark Captain collects everything you save — Chrome bookmarks, X bookmarks, Reddit,
Instagram and LinkedIn saves, YouTube Watch later — into **one inbox**, where you read it, snooze it, or
clear it out.

It has three parts:

| Part                 | What it does                                                 | Where it runs         |
| -------------------- | ------------------------------------------------------------ | --------------------- |
| **Website** (inbox)  | Shows and organises your saved items                         | http://localhost:3000 |
| **API** (server)     | Stores your items in the database                            | http://localhost:4000 |
| **Chrome extension** | Collects your saves from Chrome and each site, sends them in | Your Chrome browser   |

---

## 1. One-time setup

### 1.1 Start the app

In a terminal, in the project folder:

```bash
pnpm dev
```

This starts the website, the API, and keeps the extension rebuilt as code changes. **Keep it
running** while you use the app. If it isn't running, nothing is lost: saves wait in the
extension (the popup shows "N waiting to sync") and are sent when it is back.

> First time on a new computer? Follow the **Setup** section of the [README](../README.md)
> first (install, `.env`, database).

### 1.2 Sign in

Open **http://localhost:3000** and sign in (locally: **Development sign-in** with any email,
no password).

### Open it on your phone (same Wi-Fi)

`localhost` only works on the computer itself. To use the app from a phone on the same Wi-Fi,
start the API and website with the computer's network address instead of `pnpm dev`:

1. Find the computer's address: `ipconfig` → **IPv4 Address**, e.g. `192.168.29.227`.
2. In two terminals (PowerShell), replacing the address with yours:

   ```powershell
   $env:WEB_URL = 'http://192.168.29.227:3000'; pnpm --filter @bc/api dev
   ```

   ```powershell
   $env:NEXT_PUBLIC_API_URL = 'http://192.168.29.227:4000'; pnpm --filter @bc/web dev
   ```

3. On the phone **and** on the computer, open **http://192.168.29.227:3000** and sign in with
   the same email as usual. `localhost:3000` doesn't work while it runs this way, and the
   Settings page can't see the extension (syncing itself keeps working).

When you're done, stop both and go back to `pnpm dev`. While it runs this way, anyone on the
same Wi-Fi who opens that address can use Development sign-in, which has no password: only do
this on a network you trust. If the phone can't connect, allow Node.js through Windows
Firewall when Windows asks.

### 1.3 Install the extension

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder `apps/extension/dist` inside the project.
4. Pin it: click the puzzle-piece icon in Chrome's toolbar → pin **Bookmark Captain**.

### 1.4 Connect the extension to your account

1. Click the Bookmark Captain icon → **Connect account**.
2. On the page that opens, click **Connect extension**.
3. You should see **"Connected. Your browser bookmarks are being imported now."**
4. The popup now shows **Browser bookmarks: Connected** with a green dot. Your Chrome bookmarks
   start arriving in the inbox.

### 1.5 Turn on AI summaries (optional)

With AI on, every bookmark gets a short summary, a clear headline, topics, a type (tutorial,
video, news…), a reading time and a "shelf life". Without it, the app works exactly as before.

1. Pick a provider and add its lines to the project's `.env`:
   - **Groq (free, no card).** Sign in at [console.groq.com](https://console.groq.com) →
     **API Keys** → **Create API Key**, then:
     ```bash
     AI_PROVIDER=groq
     AI_API_KEY=gsk_…
     ```
   - **Claude (paid, best summaries).** A key from the
     [Claude Console](https://console.anthropic.com/): `ANTHROPIC_API_KEY=sk-ant-…`
   - Others (Gemini, a local Ollama…): see the comments in `.env.example`.
2. Optional, for search by meaning later: a [Voyage AI](https://dashboard.voyageai.com) key
   (200M free tokens, no card) as `VOYAGE_API_KEY=pa-…`
3. Restart `pnpm dev`. The API log says **AI enrichment on** and names the model.

Bookmarks you already have are summarised in the background, newest first. On Groq's free tier
that is about 150–200 bookmarks a day: a large library fills in over a few days, by itself.

---

## 2. Connect your platforms

**Before connecting, log in to each site in this same Chrome.** The extension reads your saves
through your own login; it never sees or stores your passwords.

Then, on the website: **Settings → Platforms → Connect …** (or the same buttons in the
extension popup). Connect one platform at a time.

What happens: a tab opens and shows **"Importing your saved posts… N found"**. Wait for
**"Done. N saved posts sent to your inbox."**, then click **Close tab**. Settings now shows the
platform as **Connected · N posts synced**.

| Platform      | What gets imported                 | Where you save it                                                 |
| ------------- | ---------------------------------- | ----------------------------------------------------------------- |
| **X**         | Your Bookmarks                     | The bookmark icon on any post                                     |
| **Reddit**    | Saved posts **and saved comments** | **Save** in a post's or comment's ⋯ menu                          |
| **Instagram** | Saved posts, reels and carousels   | The save (ribbon) icon under a post                               |
| **LinkedIn**  | Saved posts                        | **Save** in a post's ⋯ menu                                       |
| **YouTube**   | Your **Watch later** playlist      | The clock (Watch later) button, the ⋯ menu, or Save → Watch later |

### Any other site (experimental)

For sites without a built-in connector (Pinterest, Medium, …):

1. Open the page that **lists your saved posts** on that site — not a single post.
2. Scroll so a few saved posts are visible.
3. Click the extension icon → **Sync this list**, and allow access to that site.
4. A box appears **on the page itself**: "Found N saved posts… Do these look right?" with the
   first titles. Click **Looks right** to import, or **Not right** to cancel.

If it can't read the site, click **Copy details** in that box: it describes the page's
structure (not your posts) and is what's needed to fix it.

---

## 3. How new saves arrive

| You do this (in Chrome)                       | It shows up in your inbox                       |
| --------------------------------------------- | ----------------------------------------------- |
| Add, edit or remove a Chrome bookmark         | Within seconds                                  |
| Save a post on X, Reddit, Instagram, LinkedIn | Within seconds                                  |
| Add a video to YouTube Watch later            | Within seconds                                  |
| **Unsave** it (or remove from Watch later)    | It is removed from your inbox within seconds    |
| Save something **on your phone**              | At the next check: every 30–60 min, Chrome open |
| Open your saved page / Watch later yourself   | Right away (counts as a check)                  |
| Can't wait                                    | Click **Sync now** (Settings or popup)          |

Background checks only happen **while Chrome is open** on this computer. Saves made while it is
closed come in at the first check after you open it.

---

## 4. Using the inbox

### Views and sources (left sidebar; on a phone, the chips under the top bar)

| View         | Shows                                                        |
| ------------ | ------------------------------------------------------------ |
| **Inbox**    | Everything new or opened, and not snoozed                    |
| **Snoozed**  | Items hidden until a later date; they come back on their own |
| **Done**     | Items you finished                                           |
| **Archived** | Items you want to keep out of the way                        |
| **All**      | Everything                                                   |

The number next to each view is how many items it holds; the Inbox number turns colourful while
something is unread. Under **Sources**, click a platform (with its logo) to see only its items,
and **Every source** to see them all again. The address bar keeps your choice
(e.g. `/inbox?view=done&source=x`), so Back works and you can bookmark a view.

Each item shows its platform's logo (X, Reddit, Instagram, YouTube…) or, for links, the
website's own icon, plus the post's picture when it has one (YouTube thumbnails, GitHub
repository cards, images from posts). A dot before the title marks **unread** items; it
disappears when you open the link.

**Cards or list:** the two buttons next to **Import** switch between picture cards and a compact
list. Your choice is remembered in this browser.

### Actions on an item (hover over it; on a phone they are always shown)

- **✓ Done** — finished with it.
- **⏰ Snooze** → **Tomorrow morning / In 3 days / Next week** — hides it until 9:00 that day.
  **Unsnooze** brings it back now.
- **Archive** — keep it, but out of the inbox.
- **Back to inbox** — undo Done/Archive.
- **⋯ More** → **Open in a new tab**, **Copy link**, or **Delete…** → **Delete for good** —
  removes it from Bookmark Captain.

After Done, Snooze or Archive, a message at the bottom offers **Undo** for a few seconds.

**Keyboard:** **J** / **K** move between items, **Enter** opens the selected one, **E** marks it
done, **S** snoozes, **A** archives, **Z** undoes the last action, **/** jumps to the search box
and **Esc** clears the selection.

> **Tip:** for posts from X, Reddit, Instagram or YouTube, prefer **Done** or **Archive**. If a
> post is still saved on the site, **Delete** only removes it here, and the next sync may bring
> it back. To get rid of it for good, unsave it on the site.

### AI summaries (when turned on, see 1.5)

- A new item first shows **✨ Summarising…**; a few seconds later the card fills in by itself.
- The line marked **✨** is written by AI. For posts, the AI headline replaces the post's
  opening words; click **Show original** to read the post as saved.
- Next to the author: what kind of thing it is (**Tutorial**, **Video**, **News**…), about how
  long it takes to read or watch, and its shelf life: **Evergreen** (still useful in a year),
  **Timely** (weeks or months) or **Short-lived** (read it soon or let it go).
- Click a **#topic** to see everything you saved about it, from every platform.
- When a post's text changes on the site, it is summarised again.

### Finding things

- **Search** box ("Search your saves, or paste a link"): searches titles, links, authors, and
  the AI headlines, summaries and topics.
- **Related by meaning** (needs `VOYAGE_API_KEY`, see 1.5): below the word matches, bookmarks
  about the **same idea in other words**, e.g. "feeling stuck and unmotivated" finds motivation
  reels that never use those words. It also helps with typos and Hindi/English mixes. If nothing
  contains your words, you see these instead of "no matches".
  - Works best with a few words describing what you want; single words are better served by
    the normal search above it.
  - Covers bookmarks that already have a summary; the note under the list says how many.
  - Keeps working when summaries are switched off (only `VOYAGE_API_KEY` needed).
  - "Search by meaning is busy": Voyage's free limit (3 searches a minute without a card on
    file) was reached; wait a minute.
- **Sources** in the sidebar: show only one source (X, Reddit, a website…).

### Adding things by hand

- **Paste a link** into the search box → **Save link** (or press Enter). Text that looks like a
  web address (`example.com/page`, `https://…`) is offered for saving instead of searched.
- **Import**: upload a bookmarks.html export from Chrome, Firefox, Safari or Edge.
  Duplicates are merged, and tracking tags (like `utm_source`) are removed from links.

---

## 5. Settings

**Settings → Platforms**, for each connected platform:

| Button            | What it does                                             |
| ----------------- | -------------------------------------------------------- |
| **Sync now**      | Checks for new saves right away                          |
| **Re-import all** | Reads the whole saved list again                         |
| **Disconnect**    | Stops syncing that platform. Items already imported stay |

**Settings → Connected devices** lists the browsers connected to your account (the Chrome
extension). **Disconnect** there removes that browser's access.

To disconnect Chrome completely: extension popup → **Disconnect this browser**.

---

## 6. After the code changes (updates)

`pnpm dev` rebuilds the extension automatically, but **Chrome doesn't load the new version on
its own**:

1. `chrome://extensions` → click the **reload** icon (↻) on Bookmark Captain.
2. **Reload any open X / Reddit / Instagram / LinkedIn / YouTube tabs** — tabs opened before the reload keep
   running the old code.
3. **Reload any open Bookmark Captain tabs** (localhost:3000) — until you do, Settings says the
   extension "isn't installed".

If `pnpm dev` isn't running, build it first: `pnpm --filter @bc/extension build`.

If the inbox says **"Couldn't load bookmarks"** right after an update, the database needs the
update too: run `pnpm db:migrate`, then reload the page.

After an update that adds a new site, Chrome may ask you to **approve access** to that site
when you reload the extension.

---

## 7. Troubleshooting

| You see                                                                           | What to do                                                                                                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect page says the extension isn't installed                                   | The page was open before installing: click **Check again** or reload the page                                                                                             |
| Settings says the extension "isn't installed" right after reloading the extension | The tab was open during the reload: reload the page (F5)                                                                                                                  |
| Popup not connected / "The access key was rejected"                               | Popup → **Connect account** → **Reconnect extension**                                                                                                                     |
| "Sign in to Reddit in this browser, then sync again" (or another platform)        | Log in to that site in this Chrome, then **Sync now**                                                                                                                     |
| "… didn't load your saved posts"                                                  | Click **Sync now**. If it repeats, the site may have changed — see below                                                                                                  |
| Nothing arrives at all                                                            | Is `pnpm dev` running? The popup's "waiting to sync" count shows what is queued                                                                                           |
| "N bookmarks were skipped: url: Too big…"                                         | Some Chrome bookmarks have extremely long addresses (over 4,096 characters); they are skipped                                                                             |
| Errors on `chrome://extensions` mentioning google.com / "Content Security Policy" | Harmless: the site blocking its own trackers, blamed on the extension. Click **Clear all**                                                                                |
| A disconnected platform shows as connected again                                  | Note what you did just before, and report it                                                                                                                              |
| "Couldn't load bookmarks" after an update                                         | Run `pnpm db:migrate`, then reload the page                                                                                                                               |
| **Summarising…** for a long time                                                  | Check the API log for "Enrichment paused" and its `reason`: a rate limit just waits (on Groq's free tier, sometimes until the next day); "was rejected" means a wrong key |
| A card has no summary, but others do                                              | The AI gave up on it after a few tries (or declined it); it is retried if its text changes                                                                                |

**When a site stops working.** X, Reddit, Instagram, LinkedIn and YouTube change their websites from time
to time. If imports or live saves stop working for one site, the connector for that site
needs an update. Useful things to collect: a screenshot of the Settings → Platforms row, any
error on `chrome://extensions` → Bookmark Captain → **Errors**, and what you clicked.

---

## 8. Good to know

- **Privacy.** Your passwords never leave Chrome. The extension reads your saved lists through
  your own logged-in session and sends only the saved items to your own server.
- **AI summaries send your saved items to the AI provider.** With AI on, each bookmark's
  title, link, text and author go to the provider you chose (Groq, Anthropic, …) to be
  summarised, and the summary to Voyage AI if that key is set. Your passwords and anything else
  in your browser do not. A local model (Ollama) keeps everything on your computer.
- **What AI costs.** Each bookmark is summarised once (again only if its text changes). Groq's
  free tier costs nothing but limits how many per day. With Claude it is roughly a cent per
  bookmark on the default model; `AI_MODEL=claude-haiku-4-5` is about four times cheaper.
- **Long posts.** With Groq or another OpenAI-compatible provider, only the first ~6,000
  characters of a post are sent, to stay inside free-tier limits.
- **One computer.** Platform syncing runs in the Chrome where you connected it.
- **Saved dates.** X, Instagram, LinkedIn and YouTube don't say _when_ you saved something.
  For X and Instagram the first import uses each post's publish date (YouTube: the playlist
  order); LinkedIn's uses the time of the import, keeping the saved list's order. Later saves get
  the time they were noticed.
- **Instagram images** come from links that expire after some days, so older items may lose
  their picture. The post and its link stay.
- **YouTube Watch later** isn't always newest-first, so each check reads the whole list. That
  also means a video you take out of Watch later on your phone is removed from your inbox at
  the next check, even when that leaves Watch later empty. (For X, Reddit and Instagram, unsaving on your phone doesn't remove the item
  here; mark it **Done** or **Archive** it.) Removing a video with Watch later's own **⋯ →
  Remove** sometimes doesn't say which video it was; the extension then re-reads Watch later
  in a background tab, so the video leaves your inbox within about a minute instead of seconds.
- **LinkedIn** works like YouTube here: each check reads your whole saved list, so a post you
  unsave on your phone leaves the inbox at the next check. Unsaving in Chrome removes it within
  a few seconds (the extension re-reads your saved list right after you click **Unsave**).

---

## 9. Quick reference for development

| Command                               | What it does                                      |
| ------------------------------------- | ------------------------------------------------- |
| `pnpm dev`                            | Run everything (website, API, extension rebuild)  |
| `pnpm --filter @bc/extension build`   | Build the extension into `apps/extension/dist`    |
| `pnpm test`                           | Unit and API tests                                |
| `pnpm test:e2e`                       | Browser tests (stop `pnpm dev` first: low memory) |
| `pnpm lint` / `pnpm typecheck`        | Code checks                                       |
| `pnpm --filter @bc/api ai status`     | AI progress, errors and the latest summaries      |
| `pnpm --filter @bc/api ai search "…"` | Try search by meaning over the embeddings         |

More technical detail: [README](../README.md) and [CLAUDE.md](../CLAUDE.md).
