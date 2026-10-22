# Unfinished Business 👻

**The emails you never answered come back as ghosts.**

Unfinished Business reads your real Gmail and finds threads where someone wrote to you and you
never replied. Each one becomes a translucent ghost that drifts across your desktop. The longer it
has waited, the bigger and more solid it gets. Every so often it whispers the sender's name, the
subject, and how long they've been waiting, in a low, calm British voice:

> *"41 days... Sarah is still waiting... invoice for March... It's alright. We can wait too."*

There is only one way to make a ghost leave: **deal with the email.** Reply to the thread or archive
it, and within a minute the app sees the change in Gmail and the ghost flares up and dissolves.

Built solo during a one-week build sprint themed *Haunted*.

## How it haunts

- **Real data.** It scans your own inbox and ignores newsletters, robots (`noreply@`,
  `List-Unsubscribe`, `Auto-Submitted`…), Gmail's Promotions/Social/Updates/Forums tabs, anything
  you already replied to, and anything younger than 3 days or older than 180 days.
- **It builds slowly.** One ghost at a time, oldest first, a new one every 45 seconds, up to 7 on
  screen. The edges of your screen darken as they pile up.
- **Old debts behave differently.** Fresh ghosts shy away from your cursor. Ghosts older than
  about a month drift *toward* it.
- **The voice gets worse with age.** Each line is spoken by ElevenLabs ("Nathaniel C – Suspense,
  British calm"), then run through Web Audio: older ghosts are pitched lower and slower, get more
  reverb and a creeping layer of static, and are panned to wherever the ghost is on screen.
- **Hover** a ghost to read the subject. **Click** it to open that thread in Gmail.
- **Exorcism is real work.** Ghosts leave only when Gmail shows the thread replied to, archived or
  deleted. There is no "dismiss" button.

## Safety: opt-in, on your own stuff, and reversible

| | |
|---|---|
| **Opt-in** | Nothing runs until you create your own Google OAuth client and sign in yourself. Only your account is touched. |
| **Read-only by default** | The default scope is `gmail.readonly`. The app cannot send, delete, archive or edit mail. |
| **One optional write** | `UB_LABEL=1` tags haunted threads with a `👻 haunted` label (needs `gmail.modify`). That label is the only thing it ever writes, and only if you turn it on. |
| **Kill switch** | **⌘⌥⇧G** or the 👻 in the menu bar → *Banish all* instantly hides every ghost and silences them. *Quit* stops everything. |
| **What leaves your Mac** | Gmail API calls go to Google. When voice is on, each ghost's spoken line (sender's first name, cleaned subject, number of days) is sent to ElevenLabs to be voiced. Email bodies are never read. Set `UB_VOICE=off` to keep everything local. |
| **Local storage** | Everything lives in `~/.unfinished-business/`: your OAuth client and token (file mode `600`), your ElevenLabs key (encrypted with the macOS Keychain) and cached voice clips. |
| **Undo** | **Undo everything…** at the bottom of the app window (or `npm run uninstall-haunt`) removes the label from every thread and deletes it, revokes the app's Google access, and deletes the saved sign-in, voice key and voice cache. |

## Setup (macOS)

No Terminal needed. You'll need a Google account and an ElevenLabs API key.

1. **Download the app** from the [latest release](https://github.com/Bdot0311/haunted-/releases/latest):
   `Unfinished-Business-Apple-Silicon.dmg` for M-series Macs, `…-Intel.dmg` for older ones. Open it
   and drag **Unfinished Business** into **Applications**.
2. **Open it.** The app isn't notarized by Apple, so the first time macOS says it can't verify the
   developer. Click **Done**, then **System Settings → Privacy & Security → Open Anyway**. You only
   do this once.
3. **Make your own Google OAuth client** (about 5 minutes, one time):
   1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the
      **Gmail API**.
   2. Under *OAuth consent screen*, choose **External**, leave it in **Testing**, and add your own
      address as the only test user.
   3. Under *Credentials*, create an **OAuth client ID** of type **Desktop app** and download the
      JSON file.
4. **Follow the four steps in the app window:**
   1. *Connect your Gmail*: choose that JSON file, then **Sign in with Google**. Google will say the
      app isn't verified; it's your own private app, so click **Continue** and allow read access.
   2. *Give them a voice*: paste your ElevenLabs API key. It's stored encrypted in your Keychain.
      Press **▶ Hear a ghost** to check it.
   3. *See who's waiting*: **Look in my inbox**.
   4. *Let them in*: pick *Slow burn* or *Demo* pace and press **Release the ghosts**.

You can close the window and the ghosts stay. The 👻 in the menu bar reopens it.

### Running from source

Needs Node **22.12+**.

```sh
npm install
npm start               # the app, same as above
npm run scan            # terminal-only: list your ghosts and what they'll say
npm run uninstall-haunt # terminal twin of "Undo everything…"
```

From source, the Google client file goes at `~/.unfinished-business/credentials.json` (or set
`UB_CREDENTIALS`), and the CLI reads the voice key from `ELEVENLABS_API_KEY`.

### Settings

Use environment variables, or put the same keys (camelCase) in `~/.unfinished-business/config.json`.

| Variable | Default | |
|---|---|---|
| `ELEVENLABS_API_KEY` | none | Required for voice |
| `UB_VOICE_ID` | `AeRdCCKzvd23BpJoofzx` | Any ElevenLabs voice ID |
| `UB_VOICE` | `on` | `off` keeps every subject line on your machine |
| `UB_MIN_AGE_DAYS` / `UB_MAX_AGE_DAYS` | `3` / `180` | Which silences count |
| `UB_MAX_GHOSTS` | `7` | Ghosts on screen at once |
| `UB_SPAWN_SECONDS` | `45` | Seconds between new ghosts (try `8` when recording) |
| `UB_POLL_SECONDS` | `60` | How often to check Gmail for exorcisms |
| `UB_LABEL` | off | `1` turns on the `👻 haunted` label |
| `UB_CREDENTIALS` | `~/.unfinished-business/credentials.json` | OAuth client file |

## Development

```sh
npm test   # rules, voice lines, TTS caching, scanner and label removal against a fake Gmail
```

```
src/gmail/haunt.js   pure rules: what counts as unanswered, what counts as exorcised
src/gmail/scan.js    inbox search + classification, exorcism checks
src/gmail/auth.js    installed-app OAuth (loopback + PKCE), token storage, revoke
src/gmail/label.js   the optional 👻 label and its removal
src/voice/script.js  what each ghost says, by age
src/voice/tts.js     ElevenLabs text-to-speech with an on-disk cache
src/app/             Electron: control room window, menu-bar app, click-through overlay, Web Audio chain
src/uninstall.js     everything "Undo everything…" does
bin/                 `scan` and `uninstall-haunt` CLIs
```

## License

MIT
