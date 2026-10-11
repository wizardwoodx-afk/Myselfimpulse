# Documentation

SelfImpulse is the product; the **MJ** engine runs underneath it. This is the
documentation set, grouped by what you came for. No document here carries a
version number — the runners report their own counts.

## Start here

- [STORY.md](STORY.md) — the product narrative in one spine: authorize → execute → verify → measure → prove
- [releases/FEATURES.md](releases/FEATURES.md) — every feature, in the order you meet it
- [VERIFICATION.md](VERIFICATION.md) — how the work is proved, in two tiers

## Set up

- [setup/INSTALL-ON-LAPTOP.md](setup/INSTALL-ON-LAPTOP.md) — install and first run
- [setup/DESKTOP-NATIVE.md](setup/DESKTOP-NATIVE.md) — the desktop shell
- [setup/BUILD-NATIVE.md](setup/BUILD-NATIVE.md) — building the native pieces
- [setup/DEPLOY-VERCEL.md](setup/DEPLOY-VERCEL.md) — the web build
- [setup/VENDOR.md](setup/VENDOR.md) — the vendored dependencies

## Design

- [design/specialist-routing.md](design/specialist-routing.md) — how a request becomes a crew
- [design/palette-notes.txt](design/palette-notes.txt) — early colour ideation, kept as a record

## Engine

- [RSIRALS.md](RSIRALS.md) — how the engine's own improvement work is bounded and checked
- [VERSIONING.md](VERSIONING.md) — which release number rides where
- [oss/PARSER-PROVENANCE.md](oss/PARSER-PROVENANCE.md) — where the parsers come from

## Internal (engineering records)

- [internal/PLATFORM-LIMITS.md](internal/PLATFORM-LIMITS.md) — the environment limits, stated plainly
- [internal/LEGACY-COMPAT.md](internal/LEGACY-COMPAT.md) — compatibility contracts with issued data
- [internal/IMPLEMENTATION-GAP.md](internal/IMPLEMENTATION-GAP.md) — the gap audit: what was found, fixed, and deliberately left
- [internal/POSITIONING.md](internal/POSITIONING.md) and [internal/UNIQUE-FEATURES.md](internal/UNIQUE-FEATURES.md) — market maps and the differentiated-feature ledger

Not in the product yet, and recorded in the gap audit above rather than in any
feature list: resuming an interrupted run, multi-seat crew execution, and the
self-improvement loop.
