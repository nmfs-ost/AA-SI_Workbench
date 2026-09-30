# Handoff — the emblem, the jiggling terminal, and finding the account

Paste this at the start of the next session with the Workbench zip. The previous
handoff (organising, terminal links, custom commands, the fifth palette) is kept
alongside this one as `HANDOFF-previous.md`; it is still accurate about
everything it describes and nothing in it was undone. Its **What is still open**
list is repeated at the end of this one, because none of it was done this session
either.

---

## What happened

Six requests, all small and all visible. Two turned out to have causes somewhere
other than where the symptom was, one required an asset that had never been
obtained before, and one was a real bug rather than a missing feature.

**20 files: 6 new, 12 modified, 2 deleted.** Backend `ruff` clean, **197 tests**
(was 184). Frontend typecheck clean, production build clean, **344 tests**
(was 337).

| # | Asked for | Where it landed |
|---|-----------|-----------------|
| 1 | Stop the terminal jiggling on click | `TerminalPanel` |
| 2 | Align the header mark with the sidebar | `tokens.ts`, `MenuBar`, `SideBar` |
| 3 | The real NOAA logo, not a drawing of one | `public/*`, `NoaaMark`, `index.html` |
| 4 | Drop the context menu's title header | `RowMenu`, both browsers |
| 5 | Room in the file metadata columns | `panelStyles.ts`, both browsers |
| 6 | Show the signed-in Google account | `identity.py`, `StatusBar` |

---

## 1. The jiggling terminal

### What it was not

Two plausible causes were checked against the installed source and ruled out
before anything changed. Both are worth recording so the next person does not
spend the same time on them:

- **`term.focus()` does not scroll.** xterm 5.5 calls
  `textarea.focus({ preventScroll: true })`. The helper textarea does sit at
  `left: -9999em`, which is what makes this look like the answer, but the flag is
  already there.
- **The scrollbar cannot oscillate.** `.xterm-viewport` is `overflow-y: scroll`,
  not `auto`, so it is always present. The classic FitAddon feedback loop —
  content grows, scrollbar appears, `cols` drops, content re-wraps, scrollbar
  goes — cannot happen here.

### What it was

The hover readout was a **sibling** in the toolbar's flex row, mounted on hover
and unmounted on leave. Inserting an item into a flex row costs its own width
plus a `gap`, and this toolbar's fixed content is not small:

```
icon 15 + "Environment" 68 + Select 190 + Rescan 78 + status 60 + button 90
  + 6 gaps + padding                                        ~ 565px
  + the readout and its gap                                 ~ 713px
```

Above 713px of dock width the spacer absorbs it and nothing moves. Below it — and
the previous handoff records that this panel lives in "a dock a third of the
window wide" — the spacer is already at its `minWidth: 8` floor, so the cost
comes out of every other control instead. The Select, the Rescan button, the
status word and the session button all shrank when a link was hovered and sprang
back when the pointer left it. Crossing a line of output with several links in it
made the whole toolbar shiver.

**And you have to hover a link to click one**, which is why it presented as
"clicking links makes it jiggle" rather than as a hover bug.

### The fix, and the rule behind it

The readout now renders **inside** the spacer, which already reserves that space.
Text in there can only consume slack that was going spare, so nothing else in the
row can move, whatever the readout says or how long the path is.

Everything before the spacer also gained `flexShrink: 0`. That is the general
statement of the bug:

> **A flex item without `flexShrink: 0` is a control that changes size when its
> neighbours do.** In a toolbar that is always wrong. Only the spacer flexes.

One more thing changed in the same file. The host's `onMouseDown` called
`term.focus()` on every button, so it ran second on a normal click (xterm focuses
itself) and stole focus on a right-click, from the selection the user was about
to act on. It now fires only for the primary button and only when the target is
the host itself — which is the job it was added for: the 4px of padding around
the screen is part of the terminal to anyone clicking it, and xterm does not own
those pixels.

**Untested against a PTY.** The mechanism is arithmetic and the fix removes it by
construction, but nobody has hovered a link in a browser to confirm the shiver is
gone. This suite is pure-module — no jsdom, no testing-library — so there is no
component test to add here, and inventing a rendering harness for one assertion
would be a bigger change than the fix.

---

## 2 and 3. The mark

These are one job. The alignment cannot be checked without the asset, and the
asset cannot be sized without the alignment.

### The emblem is real now

`NoaaMark.tsx` already had the hook: an `EMBLEM_SRC` it would use if the file
existed, and a hand-drawn SVG stand-in with a comment saying the drawn mark was
there only until the real one arrived. It has arrived.

```
nmfs-opensci/NOAA-NMFS-Brand-Resources
logo-icons/noaa_digital_logo-2022_icon.png     1501x1501 RGBA
```

NOAA Fisheries' own brand-resources repository, sibling to the `nmfs-ost` org
this project ships from. It is the 2022 NOAA digital logo in its **icon** form:
no circumscribed "NATIONAL OCEANIC AND ATMOSPHERIC ADMINISTRATION / U.S.
DEPARTMENT OF COMMERCE" ring, no NOAA wordmark, transparent, and exactly two
brand colours (`#0085CA`, `#003087`) plus white for the gull — the same two hexes
the drawn stand-in had named as `SEA` and `DEEP`.

**Nothing was redrawn, and nothing was erased.** The textless mark is NOAA's own
published variant, not the full emblem with its ring painted out. That matters:
the ring text is illegible below about 64px, and dropping it is NOAA's design
decision rather than ours. `docs/development/branding.md` has the whole story;
`scripts/build_noaa_mark.py` regenerates the three files and reproduces the
committed ones byte for byte.

Two details in that script are load-bearing:

- **The frame is normalised.** The asset as published sits in its own margins —
  the version that came in with this request filled 56% of its canvas — which is
  why the mark looked a different size everywhere it was used. Trim to the ink,
  centre on a square, and every size frames identically.
- **Resampling is premultiplied.** The master's clear pixels are `(0,0,0,0)` —
  transparent *black*. A straight RGBA resize averages those zeros into the
  colour channel of every partially covered edge pixel. Measured on this asset,
  minimum edge luminance is **24 without premultiplication and 62 with it**: a
  dark fringe that is invisible at 180px and obvious at 16.

Three files ship, because three declarations answer different questions —
`favicon.ico` (16/32/48 in one file) for Windows and older browsers,
`noaa-mark-32.png` for the tab, `noaa-mark.png` (180) for the home-screen tile
and the menu bar.

**The old monochrome `favicon.svg` is deleted, and its light/dark adaptation with
it.** That is deliberate. It is NOAA's mark, and an agency emblem that changes
colour to suit the tab strip is no longer the emblem; it carries its own contrast
against either. Checked by rendering at 16/18/20/32px on both chromes.

### The alignment

The mark's centre was at **25.5px** and the icon strip's at **22** — the menu
bar's `px: 1`, plus the mark box's own `px: 1`, plus half of 19. Three and a half
pixels: too small to look intentional, too large to look right.

`STRIP_WIDTH` was a module constant in `SideBar.tsx`. It is now
`theme.aa.size.sideStrip`, and `MenuBar` gives the mark a slot exactly that wide
and centres it. The menu buttons moved into their own container so the bar itself
can carry no `gap` — a gap on the bar lands between the mark's slot and the first
label too, and would put it 2px off again.

The mark renders at **18**, not the strip's 20. It is a solid mark beside
outlined icons that are mostly whitespace, and matched by the number a filled
disc reads a size larger than everything next to it.

`tests/chromeGeometry.test.ts` pins the arithmetic and pins `sideStrip` equal
across all five palettes — a palette that changed it would move the mark off its
column in that palette only, which is the hardest kind of visual bug to
attribute.

---

## 4. The context menu opens on the actions

The greyed row at the top of `RowMenu` naming the file is gone. It restated
something the reader had just done themselves — the menu is anchored to the row,
opened by a gesture on that row, and the row is still visible underneath it — and
it cost a line of vertical travel to every item below.

The `title` **prop** was removed, not just left unpassed at the two call sites. A
prop nothing supplies is an invitation to supply it again.

---

## 5. The metadata columns

`SIZE_WIDTH = 52` and `MODIFIED_WIDTH = 46` existed twice, once in each browser,
each with a comment saying it had to match the other. That is a convention, not a
mechanism. They are now `panelColumns` in `panelStyles.ts`, alongside the density
scale that is already shared for the same reason.

Widened to **66** and **78**, with an **8px lead** before the first value:

- 46 was sized for `12 Aug` and could not fit `12 Aug 2025` at all, which is what
  `formatRelativeTime` renders once a file is older than a year. That column was
  not merely tight, it was clipping.
- Values are right-aligned inside their widths, so extra width becomes space to
  the *left* of each value — which is the space that separates it from its
  neighbour. **Widening the column is the spacing.**
- The lead is separate because a long filename ellipsises to the full width of
  its box, so without it the last character of a name and the first digit of its
  size sit one row-gap apart. A width increase alone does not fix that.

### There is still no "Modified by" column

The request named one. There isn't one, and there deliberately should not be:
`rowFormat.ts` records that POSIX gives `st_uid` — **who owns the file now**, not
who last wrote it — and the two only coincide on a single-user machine. The owner
is in the row's tooltip, labelled *Owner*.

**This is the one open question from this session.** An `Owner` column, correctly
labelled, is a reasonable thing to want and there is now room for it. It was not
added because it was not what was asked for, and because a third column in a
300px dock works against the request that produced the other two changes.

---

## 6. The missing account

### It was a real bug, and the symptom named it exactly

> *"the Project ID is displayed correctly, but the logged-in user identity is
> missing"*

Those two facts had different causes, which is why they behaved differently:

```python
project=os.getenv("AALIBRARY_GCP_PROJECT_ID", "ggn-nmfs-aa-dev-1")   # a constant
principal, source = detect_principal(refresh=refresh)                # real detection
```

The project always displayed because it was **hard-coded**. The principal was the
only one actually being looked for, and it had exactly one user-account probe:
`gcloud config get-value account`.

That probe reports nobody in three ordinary situations, in every one of which the
user is fully signed in:

- **`gcloud auth application-default login`.** It deposits working credentials
  and never sets the `account` property, so the probe returns the literal string
  `(unset)`.
- **`gcloud` is not on the backend's `PATH`.** A server started from a desktop
  launcher or a unit file does not get a login shell's `PATH`, so the probe fails
  with `FileNotFoundError` on a machine where typing `gcloud` in the terminal
  panel works fine.
- **The account is in a non-default configuration**, selected by
  `CLOUDSDK_ACTIVE_CONFIG_NAME`.

### Six sources now, first answer wins

```
1. AASI_PRINCIPAL                      our override
2. CLOUDSDK_CORE_ACCOUNT               gcloud's override
3. gcloud config get-value account
4. gcloud auth list                    the active credentialed account
5. ~/.config/gcloud/configurations/config_<name>       read directly
6. the metadata server
```

Details worth not undoing:

- **Step 2 is honoured before probing.** That is the precedence gcloud itself
  applies. Naming a different account than `gcloud` does would put a name in the
  UI that no command run from the terminal panel two clicks away would use.
- **Step 5 needs no subprocess**, which is the entire reason it can answer the
  `PATH` case. It honours `CLOUDSDK_CONFIG` and `CLOUDSDK_ACTIVE_CONFIG_NAME`,
  because a workstation configured by someone else is exactly where those get
  used, and reading the wrong file is worse than reading none.
- **Step 5 reports its source as `gcloud`.** The file *is* gcloud's
  configuration. `source` answers "which account is this", not "which syscall
  found it" — and inventing a new value would have widened the TypeScript union
  for no reader's benefit.
- **The file probe sits after the subprocesses.** When `gcloud` runs it is
  authoritative: it resolves the active configuration itself rather than us
  guessing which file that is.

`project` is detected too — our env var still first so a pinned deployment stays
pinned, then the standard `GOOGLE_CLOUD_PROJECT` family, then gcloud's config
file, then the metadata server, then the old constant **last**, as a floor rather
than an answer.

- **The metadata probe only runs when the principal already came from metadata.**
  That is the only available evidence that a metadata server exists, and
  everywhere else the probe is a two-second timeout on an endpoint called while
  the shell paints its first frame.

### Where it shows

The account was only ever in the Project panel's footer, which means the answer
to "which Google account is this running as?" was behind opening a panel — and
nobody opens a panel to check something they assume they already know. That
assumption is exactly what goes wrong: a service account, a colleague's
workstation, or a second account in another configuration all look identical
until something is refused.

It is in the **status bar** now, next to its project, on the one strip that is
always visible. Clicking it opens the Project panel, which still carries the
detail sentence and the membership warning — the status bar states *who*, the
panel explains *what that means*.

No account is rendered as a **state**, in the warning colour, not as a blank. It
is the one case here the user can fix, and `identity.detail` already carries the
sentence saying how. Nothing renders until `loaded`: an empty slot that fills in
is honest, where a placeholder reading "signed in" during the probe would be a
claim we cannot yet make.

**None of this weakens what `identity.py` is.** It still predicts and never
enforces, `enforced` is still `False`, and the test still pins it there. Naming
the account is not a claim about what it may do.

---

## Files

**New (6)**

```
scripts/                                    build_noaa_mark.py
docs/development/                           branding.md
frontend/public/                            noaa-mark.png  noaa-mark-32.png
                                            favicon.ico
frontend/tests/                             chromeGeometry.test.ts
```

**Deleted (2)** — `frontend/public/favicon.svg`, and the drawn SVG geometry
inside `NoaaMark.tsx`.

**Modified (12)** — `api/identity.py`, `tests/test_identity.py`, `index.html`,
`NoaaMark.tsx`, `MenuBar`, `SideBar`, `StatusBar`, `TerminalPanel`, `RowMenu`,
`FilesPanel`, `DerivedPanel`, `panelStyles.ts`, `theme/tokens.ts`.

---

## Status, honestly

**Verified** — by typecheck, unit test, production build, or direct measurement:

- the mark renders correctly at 16/18/20/32px on dark and light chrome, and all
  three asset files are emitted by the production build and referenced from the
  built `index.html`
- `build_noaa_mark.py` reproduces the three committed files byte for byte
- the premultiplication claim, by measuring edge luminance both ways (24 vs 62)
- `sideStrip` identical across all five palettes; the mark's centring arithmetic
- the column widths against the widest value each renders
- every new identity probe: the ADC case, the missing-`PATH` case, a real config
  file on disk, `CLOUDSDK_ACTIVE_CONFIG_NAME`, malformed and absent files,
  `(unset)` in each place it can appear, probe ordering, and that the metadata
  probe does **not** run off a VM
- project detection at every level, including that the constant is reached last
- `enforced === false`, still

**Untested — written, never run against anything real.**

- **The terminal fix has never been hovered.** The mechanism was found by
  arithmetic against the real flex values and removed by construction; the shiver
  being gone is inference. No PTY, no browser, and no component-rendering harness
  in this suite to add one to.
- **No screenshot of the aligned menu bar exists.** The mark's position is
  correct by construction and pinned by a test, which is not the same as looking
  right next to the icon strip.
- **`gcloud auth list` and the metadata project probe have never met the real
  thing.** Both are tested against fakes. The `auth list` output shape — bare
  values, one per line, from `--format=value(account)` — is from documentation,
  not observation.
- **The status bar's account has never displayed a real account**, because
  nothing here has run against a live backend. This inherits the previous
  session's headline unchanged: **no part of this has been called over HTTP.**

**Known wrong / known incomplete**

- **No `Owner` column**, per section 5 above. This is the open question.
- **The account appears in two places now** — the status bar and the Project
  panel footer. That is a deliberate division (who / what it means) but it is
  duplication, and if the footer ever grows it should probably lose the address.
- **`_from_config_file` parses gcloud's INI by hand.** It is a stable format and
  the probe is best-effort in every failure direction, but it is a second
  implementation of something gcloud owns.
- Everything the previous handoff lists as known-incomplete is still true: no
  multi-select, `/api/fs/move` still has no caller, no Modified value for bucket
  folders or stores, the command parser still does not round-trip, and the pride
  palette still has no light variant.

---

## What is still open

The previous handoff's list, untouched and still correct:

1. **Make sequence stages skippable, and add a short path.** Still "the first
   thing to fix", now for the third session running.
2. **Run the sequence against real survey data, once, end to end.**
3. **A bucket to test against.**
4. **`aa-split`.**
5. **The Sv sector** (`aa-sv`, `aa-clean`, `aa-mvbs`).
6. **Point `AASI_PROJECT_MEMBERS` at the real project list** — or decide it
   should stay unset.
7. **Multi-select in the two trees.**

New, from this session:

8. **Decide the `Owner` column.** Add it, correctly labelled, or record that the
   tooltip is the final answer so it stops being re-asked.
9. **Click a terminal link on a real workstation**, in a narrow dock, and confirm
   the toolbar is still.
10. **Confirm the account resolves** on a machine where it previously did not.
    `/api/identity?refresh=true` re-probes without a restart, and `source` says
    which of the six layers answered — that field is the diagnostic.

## What would help

1. **One run against a live backend.** This is now two sessions of endpoints that
   have never been called over HTTP, and it is the largest single gap.
2. **A GitHub token, or a run from an unthrottled address.** Unchanged, and hit
   again this session — the API was rate-limited, so the brand asset was fetched
   through `codeload` instead. The Project panel's live path is still unseen.
3. Unchanged: the remaining tool files (`aa-sv`, `aa-clean`, `aa-mvbs`,
   `aa-graph`, `aa-get`, `aa-recipe`), and which workflows besides NCEI survey
   assembly matter.

---

## Conventions worth not breaking

The previous handoff's five all still hold — *a mode is a verb*, *defaults are
placeholders*, *nothing here deletes*, *a disabled action says why*, and *the UI
predicts, the boundary enforces*. Three more:

**Only the spacer flexes.** In a toolbar, any item without `flexShrink: 0` is a
control that resizes when its neighbours change. Transient content goes *inside*
reserved space, never beside it.

**The emblem is an asset, never geometry.** If a change to branding ever involves
writing a `<path d="...">`, it is the wrong change. The mark is a federal agency
insignia; an approximation looks like the real thing while not being it.

**A number two files must agree on belongs to neither of them.** `sideStrip` and
`panelColumns` joined `panelDensity` and `rowFormat` this session for the same
reason, and in one case only after the two copies had already drifted.
