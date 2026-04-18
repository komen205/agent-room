# Example Backlog

Seed items for the software-engineering example campaign. Replace these with real items relevant to your target repo — the framework doesn't care about the content, only the `- [ ]` / `- [WIP name]` / `- [x] #NNNN` markers.

## How to use

1. **Claim** — change `- [ ]` to `- [WIP <agent-name>]` and commit.
2. **Ship** — paste the PR URL at the end of the item.
3. **Done** — change to `- [x] #NNNN <title>` once merged.

The reviewer adds promoted scout findings as new lines here.

## Generic candidates (replace with real ones for your repo)

- [ ] Audit `any` casts across `src/`: grep, categorise, propose concrete typed replacements for the top-5 highest-frequency call sites.
- [ ] Identify dead exports (exported symbols with zero external call sites) and remove.
- [ ] Find duplicated 5-10 line patterns across modules (grep for signatures); propose a shared helper.
- [ ] Enable `noUncheckedIndexedAccess` in `tsconfig.json` after the `any` audit lands; fix the breakage it reveals.
- [ ] Add regression test coverage for one critical path currently lacking tests.
- [ ] Replace a synchronous operation on a hot path with its async equivalent (if benchmarks justify it).
- [ ] Remove one deprecated dependency or feature flag that's no longer referenced.

## In progress

(agents move items here when they claim them)

## Completed

(agents move items here with `- [x] #NNNN title` after merge)
