# Messenger Classic

A Windows desktop app for Facebook Messenger that looks like messenger.com did
before it closed in April 2026. You only see your chats: no feed, no Facebook
top bar, no Watch or Marketplace tabs.

It runs Facebook's own web Messenger (`facebook.com/messages`) and changes how
it looks. It doesn't use any private API, so your account isn't at more risk
than when you use Messenger in a browser. It's an unofficial app and isn't
affiliated with Meta.

## Install

Download `MessengerClassic-Setup-<version>.exe` from the repo's Releases page
and run it. Installing over an older version keeps your login and settings.

The builds aren't code-signed, so Windows SmartScreen will warn you the first
time. Click **More info → Run anyway**.

## Updates

From 1.3.0 the app checks for a new version when it starts and every 6 hours.
When one is out, it asks you first:

- **Install now** downloads the update, closes the app, installs it and opens
  the app again. Your logins and settings stay. If you're in a call, it waits
  until the call ends.
- **Later** asks again at the next check.
- **Skip this version** stops asking about that version.

You can also check yourself under **Preferences → Check for updates…**, or turn
off **Check for updates automatically** there. The portable `.exe` can't
update itself, so it opens the download page instead.

`npm run dist` also builds a single-file portable `.exe`, but Windows may not
show its notifications because it has no Start menu shortcut.

## What you get

- The late messenger.com layout. A thin title bar and a left sidebar
  (Chats, Requests, Archive, Preferences) frame Facebook's own chat list,
  conversation and info panel.
- The Facebook top bar is hidden. Press **Ctrl+Shift+B** to show it when you
  need Facebook's menus, for example to change its Dark mode setting.
- Links stay where they belong. Chats and calls open inside the app. Profiles,
  groups, posts and outside links open in your default browser.
- A tray icon, an unread count on the taskbar, a flashing taskbar button for
  new messages, and Windows notifications. Click a notification to jump to
  the chat.
- Only Messenger counts. The unread count leaves out Facebook notifications
  (comments, reactions, friend requests), and Facebook's notification pop-ups
  are closed before they show.
- Several Facebook accounts, switched in one click without logging in again.
- Five themes: **Messenger**, **Yahoo**, **Zalo**, **Viber** and
  **Telegram**. Pick one with the palette button in the sidebar, or under
  Preferences → Theme.
- With the Messenger theme, the title bar and sidebar take their colors from
  Facebook's page, so light and dark mode always match.
- Video and voice calls, including screen sharing (you pick a screen or
  window).
- A spell-check right-click menu, image copy and save, and zoom.
- A sign-in that lasts between launches, start with Windows, and close to tray.
- Your own styles. Open **Preferences → Edit custom CSS…**. Changes apply as
  soon as you save the file.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+N | New message |
| Ctrl+1 / 2 / 3 | Chats / Requests / Archive |
| Ctrl+Shift+B | Show or hide the Facebook bar |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in / out / reset |
| Ctrl+R, F5 | Reload (Ctrl+Shift+R ignores the cache) |
| Ctrl+, | Preferences menu |
| Ctrl+Shift+1…9 | Switch to account 1…9 |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous account |
| Ctrl+W | Close to tray |
| Ctrl+Q | Quit |
| Alt+Left | Back |
| F12 | Developer tools |

## Accounts

Click your profile picture at the bottom of the sidebar:

- **Add account…** opens a fresh Facebook login. Each account keeps its own
  login, so after that you switch with one click and never sign in again.
- Your accounts are listed at the top of the same menu with their unread
  counts. You can also use **Ctrl+Shift+1…9**, or **Ctrl+Tab** to cycle.
- A red dot on your picture means another account has unread messages. The
  taskbar badge and tray count all accounts.
- Other accounts keep running in the background, so their notifications still
  arrive, and clicking one opens that account. Turn off **Preferences → Keep
  other accounts running** to save memory (about 300 MB per account). Other
  accounts then load only when you switch to them.
- **Log out of …** removes that account and clears its login from the app.

Logging into an account that is already added just switches to it.

## Themes

| Theme | Look |
| --- | --- |
| Messenger | Facebook's own colors, in light or dark mode, including each chat's theme |
| Yahoo | Purple title bar and sidebar with yellow highlights, Tahoma text, square-cornered bubbles on white |
| Zalo | Blue sidebar, white panels, light-blue selected chat and your own bubbles, gray-blue chat background |
| Viber | Purple title bar, lavender selected chat and your own bubbles, rounded bubbles. Dark: deep gray-violet with purple bubbles |
| Telegram | Steel-blue title bar, green chat background, pale-green bubbles for your messages. Dark: Telegram's night blue |

Yahoo and Zalo are light only. Viber and Telegram have a light and a dark
look and follow **Preferences → Color mode** (Use system setting, Light or
Dark), whatever Facebook's own dark mode setting is. While one of these four
is on, the app turns Facebook's page to the theme's mode and replaces each
chat's own theme (gradients and wallpapers) with the theme's colors. Switch
back to Messenger to get them back.

The themes only change Facebook's color variables, so they keep working when
Facebook renames its CSS classes. The colors are in `src/skins.js` (title bar
and sidebar) and `src/inject/skins.css` (the Messenger page).

## Dark mode

This applies to the Messenger theme. Facebook picks its own colors. To let
the app's **Color mode** setting (and Windows) control them, set Facebook's
dark mode to Automatic once:

1. Press Ctrl+Shift+B.
2. Open your profile picture → Display & accessibility.
3. Set Dark mode to **Automatic**.

## Run from source

You need Node.js 20 or newer.

```bash
npm install
npm start          # run the app
npm run dist       # build the installer and portable .exe into dist/
```

### Test without a Facebook account

`test/mock-server.js` serves a fake page with the same structure as
`facebook.com/messages`:

```bash
node test/mock-server.js
# in a second terminal (PowerShell: $env:MESSENGER_URL="..."; npm start)
MESSENGER_URL=http://localhost:8123/messages/ MC_DEBUG=1 npm start
```

### Publish a release

The app finds updates through `latest.yml` on the newest GitHub release, so
every release needs these three files from `dist/`:

- `MessengerClassic-Setup-<version>.exe`
- `MessengerClassic-Setup-<version>.exe.blockmap`
- `latest.yml`

To try an update before publishing, put those files in a folder, serve it
over HTTP and start an older installed build with
`MC_UPDATE_URL=http://localhost:8765/`.

## How it works

```
┌──────────────── title bar view (local HTML, drag region) ───────────────┐
├──────┬──────────────────────────────────────────────────────────────────┤
│ side │  Facebook view (facebook.com/messages)                           │
│ bar  │  moved up by the height of Facebook's top bar, so that bar sits  │
│ view │  behind the title bar view and can't be seen                     │
└──────┴──────────────────────────────────────────────────────────────────┘
```

- `src/main.js` runs the window, its three views, the rules for which links
  stay in the app, the tray, notifications, permissions and the menus.
- `src/preload-fb.js` runs inside the Facebook page. It measures
  `div[role="banner"]` (the top bar), checks the colors in use, sends link
  clicks to the browser when needed, and connects notification clicks to the
  window. It works out the unread chats from the page title and the counts
  on the bar's buttons, because the title adds Facebook notifications to
  them, and closes Facebook's notification pop-ups. It doesn't read your
  messages.
- `src/shell/` holds the title bar and sidebar.
- `src/skins.js` and `src/inject/skins.css` define the themes.
- `src/inject/messenger.css` holds small style tweaks. Your `custom.css` is
  saved in `%APPDATA%\Messenger Classic\`.

Moving the Facebook page up keeps working when Facebook renames its CSS
classes. The app only needs the `role="banner"` attribute, which Facebook
keeps for accessibility. When a full-screen viewer (such as the photo viewer)
covers the bar, the app moves the page back so the viewer's close button can be
clicked.

## If something looks off

- **The top bar shows, or a strip is cut off.** Facebook changed its layout.
  Press Ctrl+Shift+B to switch the app's adjustment off, then open developer
  tools (F12) and check `div[role="banner"]`.
- **Requests or Archive opens the wrong page.** Facebook moved those pages.
  Change `ROUTES` at the top of `src/main.js`.
- **No notifications.** Use the installer version. Also check that
  Preferences → Desktop notifications is on and that Windows notifications are
  allowed for Messenger Classic.
