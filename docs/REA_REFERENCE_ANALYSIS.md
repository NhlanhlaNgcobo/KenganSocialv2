# Reference analysis (REA) status

## What REA is

[REA, "Reverse Engineer Anything"](https://github.com/morluto/rea) is an MIT-licensed MCP server for Claude Code. It is installed with `npx rea-agents setup`, which registers the MCP server and needs a Claude Code restart.

## Status

REA was **not installed** in the session that built keyframes, beat sync and templates, so no REA analysis was run. Nothing in this work comes from reverse engineering another product. The transitions, templates, easing curves, beat detection and template format are original implementations, written from public, general knowledge of how editors behave (for example: "transitions are centred on the cut", "templates have media placeholders").

## Allowed uses

Use REA only on software we own or are licensed to examine:

| Target | Allowed | Notes |
|---|---|---|
| KenganSocial's own client bundle, server and exports | Yes | Useful for auditing the built bundle, render output and API surface |
| Open-source editors (e.g. OpenCut, MIT; Shotcut and Kdenlive, GPL) | Yes, within their licences | Read their source directly. Copying code carries their licence terms: MIT needs attribution, GPL code cannot go into this proprietary codebase. |
| CapCut, TikTok, OpusClip and other closed apps | No | Their terms prohibit reverse engineering. Do not extract code, templates, assets or formats, and do not bypass protections. |

## Verified vs assumed

| Topic | Status |
|---|---|
| Our preview and export agree on timing, positions, opacity, zoom and cuts | **Verified** by the checks in `EDITOR_KEYFRAMES_BEATS_TEMPLATES.md` |
| Beat detection accuracy (within 12 ms on synthetic tracks, within 6 ms in a real export) | **Verified** |
| Popular editors centre transitions on the cut and offer beat markers and template placeholders | **Assumed** from public product behaviour; not measured |
| How CapCut stores or renders its templates internally | **Unknown** and deliberately not investigated |

## If REA is installed later

1. Run `npx rea-agents setup` and restart Claude Code.
2. Point it only at the targets marked "Yes" above.
3. Record each finding as verified (reproduced by a check here) or assumed.

## Competitor research without REA

OpusClip (October 2026) was studied from its public landing page and public reviews only, like any visitor; REA was not used on it. See `COMPETITIVE_UX_NOTES.md`.
