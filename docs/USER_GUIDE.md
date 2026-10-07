# Bookmark Captain — User Guide

Bookmark Captain collects everything you save — Chrome bookmarks, X bookmarks, Reddit and
Instagram saves, YouTube Watch later — into **one inbox**, where you read it, snooze it, or
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

### 1.3 Install the extension

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder `apps/extension/dist` inside the project.
4. Pin it: click the puzzle-piece icon in Chrome's toolbar → pin **Bookmark Captain**.

### 1.4 Connect the extension to your account

1. Click the Bookmark Captain icon → **Connect account**.
2. On the page that opens, click **Connect extension**.
3. You should see **"Connected. Your browser bookmarks are being imported now."**
4. The popup now shows **● Connected**. Your Chrome bookmarks start arriving in the inbox.

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
| **YouTube**   | Your **Watch later** playlist      | The clock (Watch later) button, the ⋯ menu, or Save → Watch later |

### Any other site (experimental)

For sites without a built-in connector (LinkedIn, Pinterest, …):

1. Open the page that **lists your saved posts** on that site — not a single post.
2. Scroll so a few saved posts are visible.
3. Click the extension icon → **Sync this list**, and allow access to that site.
4. A box appears **on the page itself**: "Found N saved posts… Do these look right?" with the
   first titles. Click **Looks right** to import, or **Not right** to cancel.

If it can't read the site, click **Copy details** in that box: it describes the page's
structure (not your posts) and is what's needed to fix it.

---

## 3. How new saves arrive

| You do this (in Chrome)                        | It shows up in your inbox                       |
| ---------------------------------------------- | ----------------------------------------------- |
| Add, edit or remove a Chrome bookmark          | Within seconds                                  |
| Save / bookmark a post on X, Reddit, Instagram | Within seconds                                  |
| Add a video to YouTube Watch later             | Within seconds                                  |
| **Unsave** it (or remove from Watch later)     | It is removed from your inbox within seconds    |
| Save something **on your phone**               | At the next check: every 30–60 min, Chrome open |
| Open your saved page / Watch later yourself    | Right away (counts as a check)                  |
| Can't wait                                     | Click **Sync now** (Settings or popup)          |

Background checks only happen **while Chrome is open** on this computer. Saves made while it is
closed come in at the first check after you open it.

---

## 4. Using the inbox

### Views (tabs at the top)

| View         | Shows                                                        |
| ------------ | ------------------------------------------------------------ |
| **Inbox**    | Everything new or opened, and not snoozed                    |
| **Snoozed**  | Items hidden until a later date; they come back on their own |
| **Done**     | Items you finished                                           |
| **Archived** | Items you want to keep out of the way                        |
| **All**      | Everything                                                   |

A dot marks **unread** items; it disappears when you open the link.

### Actions on an item (hover over it, or tap on a phone)

- **Done** — finished with it.
- **Snooze** → **Tomorrow morning / In 3 days / Next week** — hides it until 9:00 that day.
  **Unsnooze** brings it back now.
- **Archive** — keep it, but out of the inbox.
- **Back to inbox** — undo Done/Archive.
- **Delete** → **Confirm delete** — removes it from Bookmark Captain.

> **Tip:** for posts from X, Reddit, Instagram or YouTube, prefer **Done** or **Archive**. If a
> post is still saved on the site, **Delete** only removes it here, and the next sync may bring
> it back. To get rid of it for good, unsave it on the site.

### Finding things

- **Search** box: searches titles, links and authors.
- **All platforms** dropdown: show only one source (X, Reddit, a website…).

### Adding things by hand

- **Paste a link** into the "Link to save" box → **Save**.
- **Import bookmarks.html**: upload a bookmarks export from Chrome, Firefox, Safari or Edge.
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
2. **Reload any open X / Reddit / Instagram / YouTube tabs** — tabs opened before the reload keep
   running the old code.
3. **Reload any open Bookmark Captain tabs** (localhost:3000) — until you do, Settings says the
   extension "isn't installed".

If `pnpm dev` isn't running, build it first: `pnpm --filter @bc/extension build`.

After an update that adds a new site, Chrome may ask you to **approve access** to that site
when you reload the extension.

---

## 7. Troubleshooting

| You see                                                                           | What to do                                                                                    |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Connect page says the extension isn't installed                                   | The page was open before installing: click **Check again** or reload the page                 |
| Settings says the extension "isn't installed" right after reloading the extension | The tab was open during the reload: reload the page (F5)                                      |
| Popup not connected / "The access key was rejected"                               | Popup → **Connect account** → **Reconnect extension**                                         |
| "Sign in to Reddit in this browser, then sync again" (or X/Instagram/YouTube)     | Log in to that site in this Chrome, then **Sync now**                                         |
| "… didn't load your saved posts"                                                  | Click **Sync now**. If it repeats, the site may have changed — see below                      |
| Nothing arrives at all                                                            | Is `pnpm dev` running? The popup's "waiting to sync" count shows what is queued               |
| "N bookmarks were skipped: url: Too big…"                                         | Some Chrome bookmarks have extremely long addresses (over 4,096 characters); they are skipped |
| Errors on `chrome://extensions` mentioning google.com / "Content Security Policy" | Harmless: the site blocking its own trackers, blamed on the extension. Click **Clear all**    |
| A disconnected platform shows as connected again                                  | Note what you did just before, and report it                                                  |

**When a site stops working.** X, Reddit, Instagram and YouTube change their websites from time
to time. If imports or live saves stop working for one site, the connector for that site
needs an update. Useful things to collect: a screenshot of the Settings → Platforms row, any
error on `chrome://extensions` → Bookmark Captain → **Errors**, and what you clicked.

---

## 8. Good to know

- **Privacy.** Your passwords never leave Chrome. The extension reads your saved lists through
  your own logged-in session and sends only the saved items to your own server.
- **One computer.** Platform syncing runs in the Chrome where you connected it.
- **Saved dates.** X, Instagram and YouTube don't say _when_ you saved something. The first
  import uses each post's publish date (YouTube: the playlist order); later saves get the time
  they were noticed.
- **Instagram images** come from links that expire after some days, so older items may lose
  their picture. The post and its link stay.
- **YouTube Watch later** isn't always newest-first, so each check reads the whole list. That
  also means a video you take out of Watch later on your phone is removed from your inbox at
  the next check, even when that leaves Watch later empty. (For X, Reddit and Instagram, unsaving on your phone doesn't remove the item
  here; mark it **Done** or **Archive** it.) Removing a video with Watch later's own **⋯ →
  Remove** sometimes doesn't say which video it was; the extension then re-reads Watch later
  in a background tab, so the video leaves your inbox within about a minute instead of seconds.

---

## 9. Quick reference for development

| Command                             | What it does                                      |
| ----------------------------------- | ------------------------------------------------- |
| `pnpm dev`                          | Run everything (website, API, extension rebuild)  |
| `pnpm --filter @bc/extension build` | Build the extension into `apps/extension/dist`    |
| `pnpm test`                         | Unit and API tests                                |
| `pnpm test:e2e`                     | Browser tests (stop `pnpm dev` first: low memory) |
| `pnpm lint` / `pnpm typecheck`      | Code checks                                       |

More technical detail: [README](../README.md) and [CLAUDE.md](../CLAUDE.md).
