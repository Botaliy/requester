# Requester

Desktop WebSocket client for connection profiles, reusable messages, scenarios, variables and automatic responses.

## Run

```bash
npm install
npm start
```

Run the checks with `npm test` and `npm run check`.

## Standalone macOS app

Build the installable app on macOS:

```bash
npm install
npm run dist
```

The `dist` directory will contain:

- `Requester-1.0.0-<arch>.dmg` — open it and drag Requester into Applications;
- `Requester-1.0.0-<arch>.zip` — a portable archive containing `Requester.app`;
- `mac-<arch>/Requester.app` — the unpacked application bundle.

The local build is ad-hoc signed. It is suitable for running on the development Mac. Public distribution without Gatekeeper warnings requires an Apple Developer ID certificate and notarization.

Intel builds can be produced with `npm run dist:x64`.

## Homebrew

The prepared cask lives in `distribution/homebrew/Casks/requester.rb`. Once the versioned DMGs are published in a GitHub Release and the cask is copied to `Botaliy/homebrew-tap`, users can install the app with:

```bash
brew install --cask botaliy/tap/requester
```

See `distribution/homebrew/README.md` for the release checklist.

## Templates

Templates work in connection URLs, header JSON and message payloads:

```text
wss://example.test/socket?token={{ vars.token }}
{"sentAt": {{ Date.now() }}, "replyTo": "{{ last.id }}"}
```

Available template values:

- `vars` — static and computed workspace variables;
- `last` — the most recent incoming JSON value or text;
- `message` and `raw` — the incoming value being handled by a trigger;
- `history` — up to 200 incoming values for the active connection;
- `now` — the current ISO timestamp;
- `Date`, `Math`, `JSON` and common JavaScript value constructors.

## Variable environments

Variables are grouped into environments such as `Local`, `Staging` and `Production`. Use the `ENV` selector next to the connection URL to switch the complete active variable set in one action.

Messages, scenarios and triggers start using the selected environment immediately. If variables are used in a connection URL or headers, reconnect that connection so the new handshake values are applied. Creating an environment preserves the current variable schema and clears static values; **Duplicate** copies both the schema and values.

Computed variables and trigger conditions use JavaScript expressions. They run in a short-lived isolated VM context without access to Node.js APIs.

## Data

The workspace is saved locally in Electron's application data directory as `workspace.json`. Values are currently stored as plain text, so secrets such as production tokens should not be kept there on a shared machine.

The first version supports standard `ws://` and `wss://` WebSockets with text/JSON payloads. Socket.IO, STOMP and binary-message authoring are not yet included.
