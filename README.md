# SelfImpulse — engine MJ v19.7.16

**Intelligence Meets Collaboration.**

You describe the outcome you want. A crew of specialists does the work on your
machine, under your own provider key — and every action, including every
refusal, is sealed into a receipt you can verify later, offline, with one
command.

---

## What it is

SelfImpulse is an on-device AI captain, and it runs on the **MJ** engine. You
ask in plain words; the Captain routes the work to the right specialists and
brings back an answer. The crew works in-process on your machine, the risky
steps stop and wait for you, and nothing that happened is left unrecorded.

## What you get

- **The Captain** — one calm place to ask. The Captain routes your request to
  the right specialists and answers in words when it can't act. It answers to
  any name you give it.
- **The crew** — a company, organised. Captain → Consul → Adept → crew, one
  rung at a time. The crew is internal: you work with one Captain, not a
  roster.
- **Work** — watch a mission as a live 3D graph, from your request down to
  its receipts. Risky steps pause and ask. Approve once, or refuse with a
  reason — both are receipted.
- **Eight tools** — listing, reading and writing files, fetching a page,
  searching a wiki, running a command, driving a browser, and calling your own
  MCP tools. Each one asks before it does anything risky.
- **Federation** — your Captain works with another owner's Captain over the
  A2A protocol. Pairing is a one-time code, mounting is explicit, and every
  crossing is recorded on both sides. You choose the reach: this machine
  only, or your network.
- **Receipts** — everything that happened, including the refusals, in one
  place. Export a mission as a single signed record and verify it anywhere:
  `node tools/verify-mission-record.mjs record.json` — no install, no state.
- **Docs** — teach the Captain from your own documents. Structure is
  distilled, proposed, and installed only when you approve. Handling is
  disclosed: what stayed on this machine, and what (if anything) went to a
  provider.
- **Memory** — conversations become a 3D graph you can move through.
  Double-click a node to return to that conversation. Encrypted at rest
  behind the vault, with one switch that turns it off.
- **Triggers** — schedules, signed webhooks and named events start runs for
  you. A trigger is a doorbell, not a key: everything it starts goes through
  the same gate as your own requests.
- **Connect** — mail, calendar, repositories, documents. A connection is a
  declared, inspectable policy: one purpose, one address range, scopes in
  plain words. Connecting teaches the crew where it may go; it never adds a
  tool. Mutations still stop at the gate.
- **Governance evals** — the behaviours that must hold, held by an explicit
  baseline, with a gate that names what moved.
- **Ledgers** — spend per seat and per mission with a chargeback export, fleet
  identity under a key you can revoke, and assurance that refuses to exist
  without evidence.
- **Capabilities** — an approval at the gate mints a signed, scoped, expiring,
  redeem-once capability, and the execution plane has to verify it before
  anything takes effect.
- **Finishes** — seven finishes, day and night; every one checked for contrast
  by machine.

## How it works

You ask. The Captain routes. The crew works. Every step is a small, named
action with a risk tier: the safe ones run, the risky ones stop at the gate and
wait for you, and either way the step writes a receipt. Nothing leaves your
machine without a signed authority behind it.

## The promises

- **On-device.** Every agent runs in-process, on your machine, on your own
  provider key. Nothing leaves your machine without a signed authority and a
  receipt.
- **Your key, sealed.** Provider keys live in memory for the session, or
  encrypted at rest behind a passphrase vault.
- **The human gate.** Actions above the safe tier stop and ask. Approve once,
  or refuse with a reason — both are recorded.
- **Honest outcomes.** Without a provider the Captain plans, and says so. A
  claim is fetched and checked before it is called verified.
- **Bounded autonomy.** You choose how far the Captain may go on its own,
  inside hard caps, through the same governed path, with a circuit breaker.

## Run it

```bash
npm install
npm test                # 214 suites
npm run dev             # the web app, in development
npm run web:build       # the production artifact: static files in dist/
npm run tauri:build     # the desktop shell
node verify/run.mjs     # the offline pack — 213 bundles, no install
```

Node 22.12 or newer. The desktop build needs the Rust toolchain
([docs/setup/DESKTOP-NATIVE.md](docs/setup/DESKTOP-NATIVE.md)).

### What actually ships

**The production artifact is the static `dist/` directory.** `npm run web:build`
emits it and any static host serves it: no Node process, no `npm start`,
nothing to keep alive. The offline verification pack ships in the same box —
213 self-contained bundles, no install, no network — so anyone with Node can
check the work.

`npm run dev` is a **development server only**. It is not the product, and
nothing in `dist/` depends on it being up.

A2A federation is the only feature that binds a TCP port. It binds to this
machine only and does not widen itself: reaching your network is a choice you
make, in words. In the static `dist/` edition that listener does not exist, so
the browser edition holds no port at all.

## Where to read more

| Read | For |
|---|---|
| [docs/STORY.md](docs/STORY.md) | the product narrative, one spine |
| [docs/releases/FEATURES.md](docs/releases/FEATURES.md) | every feature, in the order you meet it |
| [docs/VERIFICATION.md](docs/VERIFICATION.md) | how the work is proved |
| [docs/setup/](docs/setup/) | install, desktop build, deploy |
| [CONTRIBUTING.md](CONTRIBUTING.md) | how to work on this tree |
| [SECURITY.md](SECURITY.md) | how to report a security issue |
| [docs/internal/](docs/internal/) | engineering records: limits, compatibility, gap audits |

## License

[MIT](LICENSE). Third-party notices:
[docs/legal/THIRD-PARTY-NOTICES.md](docs/legal/THIRD-PARTY-NOTICES.md).
