# Contributing to LectureInk

Thanks for helping. Bug reports, site fixes and pull requests are all welcome.

## Setup

```bash
npm install
npm run dev          # Chrome with live reload
```

## Before you open a pull request

```bash
npm run check   # TypeScript
npm test        # unit tests (vitest)
npm run build
```

Then load the build and watch one lecture with captions and one without.

## Where things live

- A site's captions or titles are not detected: edit `lib/platforms.ts`.
- The notes are too long, too short, or wrong: edit the prompt in `lib/prompts.ts`.
- The markdown output format: edit `lib/notes.ts`, and update `lib/lib.test.ts` to match.
- To add a provider: if it has an OpenAI-compatible API, add one entry to `PROVIDERS` in `lib/ai.ts`.

## Ground rules

- Keep it local-first. Do not add a backend, telemetry, or accounts.
- Never log or write API keys anywhere except `storage.local`.
- Add new dependencies only when a few lines of code cannot do the job.
