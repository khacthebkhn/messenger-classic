# Messenger Classic

A Windows desktop app for Facebook Messenger that looks like messenger.com did
before it closed in April 2026. You only see your chats: no feed, no Facebook
top bar, no Watch or Marketplace tabs.

It runs Facebook's own web Messenger (`facebook.com/messages`) and changes how
it looks. It doesn't use any private API, so your account isn't at more risk
than when you use Messenger in a browser. It's an unofficial app and isn't
affiliated with Meta.

## Install

| File | Use it when |
| --- | --- |
| `Messenger Classic Setup 1.0.0.exe` | You want the normal install. This version also gets desktop notifications. |
| `MessengerClassic-1.0.0-portable.exe` | You want one file and no install. Notifications might not appear. |

The builds aren't code-signed, so Windows SmartScreen will warn you the first
time. Click **More info → Run anyway**.

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
- The title bar and sidebar take their colors from Facebook's page, so light
  and dark mode always match.
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
| Ctrl+W | Close to tray |
| Ctrl+Q | Quit |
| Alt+Left | Back |
| F12 | Developer tools |

## Dark mode

Facebook picks its own colors. To let the app's **Theme** setting (and
Windows) control them, set Facebook's dark mode to Automatic once:

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
  window. It doesn't read your messages.
- `src/shell/` holds the title bar and sidebar.
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
