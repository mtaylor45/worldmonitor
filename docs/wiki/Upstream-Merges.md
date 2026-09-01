# Upstream merges

Upstream is [koala73/worldmonitor](https://github.com/koala73/worldmonitor):
6,000+ commits, actively maintained. This is the routine.

---

## The merge

```bash
git remote add upstream https://github.com/koala73/worldmonitor.git   # once
git fetch upstream
git merge upstream/main
```

Expect exactly one predictable conflict: **`README.md`**. Ours describes this
fork and needs nothing from upstream's, so:

```bash
git checkout --ours README.md
git add README.md
```

Anything else that conflicts is worth reading carefully — it means an upstream
change landed in one of the three lines we own, or in markup our engine depends
on.

---

## Then run all three suites

```bash
npx vitest run --config vitest.dom.config.mts tests/dom/theme-token-contract.test.mts
npx vitest run --config vitest.dom.config.mts tests/dom/theme-engine.test.mts
npx playwright test e2e/theme-engine-p0.spec.ts
```

Each is protecting against a different upstream change:

| Suite | Catches |
|---|---|
| **Token contract** | Upstream retuning a colour or spacing value our extraction recorded |
| **Theme engine** | Chrome lifecycle, cycle stability, re-mount behaviour |
| **e2e acceptance** | Upstream changing the shell or panel markup the engine depends on |

**When the token drift test fails, re-run the extraction procedure in
[`docs/P0-PORT.md`](https://github.com/mtaylor45/worldmonitor/blob/main/docs/P0-PORT.md).
Do not edit the expectation to match.** The test exists to tell you upstream
moved; editing the number to agree with it discards the only signal you had.

The sidecar suite is independent of upstream and does not need re-running for a
merge, but it is cheap:

```bash
cd voice-sidecar && python3 -m unittest discover -s tests -t .
```

---

## Things that break in predictable ways

**The header degradation ladder.** Upstream drops header items as the *viewport*
narrows (`main.css`). The LCARS frame narrows the *container*, so that ladder
never fires and upstream's right-hand controls run off the edge — silently,
because `.main-content` has `overflow-x: hidden`. `lcars.css` re-runs upstream's
own ladder at shifted breakpoints, and the e2e asserts `scrollWidth`.

**If upstream retunes its ladder, this must be re-derived**, recorded in
`docs/UPSTREAM-DIFF.md`, and re-checked against the header-fit assertion.

**Panel keys.** Rail buttons and voice `panel.focus` targets are `data-panel`
keys verified against a running dashboard. If upstream renames or removes a
panel, the button silently does nothing — which on a wall panel is
indistinguishable from a broken display. The e2e asserts every rail target
resolves.

**The snapshot's markup selectors.** `src/context/snapshot.ts` is the only place
that reads upstream markup for the LLM. The coupling is real but confined to one
versioned file: when upstream changes its markup, one selector moves and nothing
downstream notices.

**The risk-scores response shape.** `readings_from_risk_scores()` in
`wm_voice/alerts.py` is the one place that knows the shape of an upstream API
response. Field names were read from
`src/generated/client/worldmonitor/intelligence/v1/service_client.ts`. It drops
junk entries rather than turning a schema change into a false alarm, but a
silent schema move would stop alerts firing — check it if alerts go quiet after
a merge.

---

## Update the register

Every upstream file touched goes in
[`docs/UPSTREAM-DIFF.md`](https://github.com/mtaylor45/worldmonitor/blob/main/docs/UPSTREAM-DIFF.md),
with the baseline commit. That register is what makes the surface small enough
to audit before the *next* merge.
