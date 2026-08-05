# Handoff — organising, links, custom commands, and a fifth palette

Paste this at the start of the next session with the Workbench zip. The previous
handoff (tool discovery, the job runner, the NCEI sequence) is still accurate
about everything it describes; nothing in it was undone. Its **Next** list is
also still the right list, and none of it was done this session — see
*What is still open*.

---

## What happened

Five requests, all UI-facing, all landed. One required reversing a documented
design decision, one required a new backend module, and one required being
careful about a claim the UI must not make.

**40 files: 15 new, 25 modified** (plus this document). Backend `ruff` clean,
**184 tests** (was 126).
Frontend typecheck clean, production build clean, **337 tests** (was 230).

| # | Asked for | Where it landed |
|---|-----------|-----------------|
| 1 | Right-click file operations; a Modified column | `files.py`, `RowMenu`, both browsers |
| 2 | Pipeline cards from custom bash | `commandParser.ts`, `NewPipelineDialog` |
| 3 | Clickable links in the terminal | `terminalLinks.ts`, `TerminalPanel` |
| 4 | A side panel of project links | `ResourcesPanel`, `githubApi.ts` |
| 5 | A rainbow pride theme | `tokens.ts`, `MenuBar` |

---

## 1. Organising files

### The decision that was reversed

`files.py` used to document, at length, that there is deliberately **no delete,
move, or rename**, on the grounds that a destructive action one misclick from a
listing is a poor trade. That docstring was rewritten rather than quietly
bypassed, because it was load-bearing documentation and the next reader deserves
to know it changed on purpose.

The reasoning was right about *deletion* and wrong about the conclusion. The
alternative it left users was `rm` at a terminal, which fails worse in exactly
the way the argument worried about. The trade is now answered directly instead:

- **There is still no delete.** `/trash` *moves*. Nothing in the module unlinks
  a file the user can see; the one `unlink` removes a `.trashinfo` sidecar the
  module wrote seconds earlier.
- **Trashing is reversible from inside the Workbench.** `/trash` returns the
  token `/restore` needs, so the panel offers **Moved to Trash · Undo** rather
  than an irreversible action behind a confirmation dialog. A confirmation is
  the weaker guarantee: it asks the user to be certain *in advance*, which is
  when they have the least information.
- The destination follows the **XDG Trash spec**, so a desktop Files app sees
  the same trash and can restore from it independently.
- **Rename is a leaf operation.** A name containing a separator is rejected
  rather than resolved, so renaming cannot relocate a file.

### New endpoints

```
GET  /api/fs/stat?path=      describe one path, without listing or reading it
POST /api/fs/rename          { path, name }         leaf-only, never overwrites
POST /api/fs/move            { path, destination }  never overwrites, no self-subtree
POST /api/fs/trash           { path }            -> { trashedTo, token }
POST /api/fs/restore         { token }
GET  /api/identity?refresh=  see §4
```

All are behind `_guard_write()`, so `AASI_FS_READONLY` still removes the whole
mutating half, and behind the existing non-loopback guard. Both are asserted by
parametrised tests naming every new route.

Three details worth not undoing:

- **The `.trashinfo` sidecar is written first, with `O_EXCL`.** It is what
  claims the name in the trash. Writing the file first and the sidecar second
  leaves an orphan in `files/` if the second step fails — an entry the trash can
  *display* but cannot *restore*.
- **A restore path is untrusted input.** The sidecar is a file on disk, shared
  with the desktop and editable by hand, so its `Path=` goes back through
  `_resolve` exactly like a path arriving in a query string. A test hand-edits
  one to point outside the root and asserts a 403.
- **`_leaf_name` is shared by create and rename.** They need identical rules,
  and it is the rule that stops a rename becoming a move.

### `owner`, not `modifiedBy`

`FsEntry` gained `owner`, cached per uid. The name is the point: POSIX records
`st_uid`, which is **who owns the file now**, not who last wrote it. On a
single-user workstation they coincide; on a shared one they do not, and a column
headed "modified by" built on this would be confidently wrong. The UI labels it
*Owner* for the same reason.

`modifiedAt` was already on the wire and had simply never been rendered.

### The menu

`components/panels/RowMenu.tsx` — **one component, both browsers**. They sit one
icon apart in the same dock doing the same job on different storage, and
`panelStyles.ts` already records what happened the last time they diverged.

Two ways in, one action list:

- **Right-click the row.** What everyone tries first.
- **A ⋮ button at the row's right edge**, revealed on hover like
  `CopyPathButton`. Right-click is undiscoverable — nothing on screen says it is
  there — and unavailable outright from a touchscreen or an assistive pointer.
  The button makes the actions *visible*; the right-click makes them *fast*.

**Disabled items show their reason rather than hiding.** A hidden action is
indistinguishable from an action that does not exist, which sends people to the
terminal to do it by hand — the exact outcome the menu exists to prevent.

The **Bucket menu is read-only** and carries **no Delete item, not even a
disabled one**. `/api/derived` has no mutating route at all; these objects are
pipeline output, a store deleted here is a store some run has to produce again,
and the console already offers deletion to anyone whose IAM role permits it. A
disabled item would promise the action is coming. It is not. What the menu does
add is the per-object console link — the header button only ever opened the
bucket *root*, which is useless six prefixes deep.

### The Modified column

Right-aligned, fixed width, with a real header row in both trees — the header is
what turns a ragged right edge into something the eye can scan down. Values are
relative (`now`, `12m`, `3h`, `5d`, then a date at a week), because the question
is nearly always "is this the file the job just wrote?" and `2h` answers it where
an ISO timestamp does not. Exact stamp and owner live in the tooltip.

`formatBytes` had been written twice, identically, in both panels; it and the new
time formatting now live in `panels/rowFormat.ts`.

### Renaming an open file

A Dockview panel's id **embeds the file path** (`editor/panelIds.ts`), so a
renamed file cannot keep its tab: the id is wrong and `params.path` points at
something gone. Dropping the doc from the store is not enough — Dockview would
still render the panel.

So `editors.ts` gained a `CloseRequest`, the mirror of the existing
`OpenRequest`, consumed by `DockLayout` the same way; and `renameOpenFile`
re-keys the buffer to the new path. **Unsaved edits survive the rename** — the
buffer is moved, not reloaded, for the same reason `openFile` refuses to
re-fetch a path it already holds.

---

## 2. Pipelines from custom bash

`pipelines/commandParser.ts` + a rewritten `NewPipelineDialog`.

### What changed and why

Building a pipeline used to be clicking tool buttons. That works for the tools
the catalogue lists and for nothing else — not the `aa-*` tools that ship later,
and not the Unix toolbox, which is genuinely useful in a pipe chain. The escape
hatch was one "Custom command" button producing an opaque freeform stage, so the
real choice on offer was: *structure for a handful of tools, or a text box with
no structure at all.*

**The command is now the input, and the structure is recovered from it.** A
command line is already the notation everyone here types, reads in the docs, and
pastes from a colleague.

```
aa-fetch -o ./downloads {input} | grep -v WARN | aa-combine -o combined.zarr
   ^ structured                    ^ freeform     ^ structured
```

- Split on top-level pipes; each segment is a stage.
- If the segment's program is in the catalogue **and every token maps to a
  declared flag**, it becomes a real stage: real params, a working Configuration
  panel, an argv the job runner can execute.
- Otherwise the segment keeps its text verbatim and runs as a freeform stage.

The tool chips remain, but they now **insert into the command** rather than
appending a hidden stage. That is what makes this the better of the two rather
than a replacement: someone who does not know the tool names can still find
them, and what they get back is a command they can then edit.

### The rule not to relax

**A stage is structured only if *every* token is accounted for.** Partial mapping
is the tempting version and it is the dangerous one:
`aa-combine -o out.zarr --nonexistent 3` would keep the two flags it understood,
silently drop the third, and generate a command that is **not the one the user
typed**. Since the whole promise is "what you typed is what runs", an
unrecognised token demotes its stage to freeform, where the text is preserved
exactly — and the dialog says *which* token did it, so the demotion is visible
rather than mysterious.

Redirection, subshells, globbing, variables and `&&` are not interpreted. They
land in a segment, fail the mapping rule, and end up in a freeform stage handed
to a real shell. That is the correct outcome for all of them, and it is why the
parser can be this small.

`createPipeline` gained an optional `values` argument, because a stage list alone
cannot carry the flags a user typed or the verbatim text of a freeform stage. It
seeds the Default configuration and deliberately **does not** rewrite
`ParamDef.default` — `pipelineTypes` records that an untouched field must send
nothing so the tool's own default keeps applying, and pinning a typed value in as
a default would quietly end that.

---

## 3. Terminal links

`panels/terminalLinks.ts` (pure, 34 tests) + a link provider in `TerminalPanel`.

Three kinds: `http(s)` opens a tab; `gs://` selects the object in the right dock
exactly as clicking it in the Derived panel does; an absolute path (or one under
`~`) opens in the editor, or reveals in Files when it is a directory.

This is not decoration. The first thing every one of these tools prints is a
*location* — `aa-fetch` a run directory, `aa-ed` a directory, `aa-combine` a
store, `aa-upload` a bucket URI — and the next thing the user does is select it,
copy it and paste it into another panel. The click is that step.

Four things that were not obvious:

- **Wrapped lines are the normal case, not an edge case.** These paths are long
  and the terminal lives in a dock a third of the window wide. A provider that
  looked at single rows would link the first 80 characters of every run
  directory and stop — which is *worse* than no link, because it looks like it
  worked. `logicalLineAt` reassembles the logical line first.
- **`/api/fs/stat` exists for this.** Whether a path is a file or a directory
  decides which panel answers, and the text cannot say: the directories these
  tools print have no extension. The alternatives were guessing from the suffix
  (wrong every time) or calling `/list` and treating an error as "it's a file",
  which enumerates a survey directory to answer a yes/no question.
- **No new dependency.** `@xterm/addon-web-links` handles one of the three kinds;
  using it plus a hand-rolled provider for the other two would mean two hover
  styles and two activation paths for one gesture.
- **Right-click is never hijacked.** That is the selection menu, and a terminal
  without one is a broken terminal.

`SubjectOrigin` gained `'Terminal'` — the inspector chip's whole job is saying
where a selection came from, and reporting one of the other three would be a
small lie in exactly the wrong place.

---

## 4. The Project panel — and the permissions question

### The panel

New left-dock panel (`resources`), icon `HubOutlined`, titled **Project**. It is
on the left because that strip already carries the shell's standing,
selection-independent things (the environment updater and feedback dialog, under
a divider), whereas the right dock is entirely "about the thing currently
selected", which this is not. The strip's accessible name changed from
`Data sources` to `Data sources and project links`, because the old one had
stopped being true.

Repositories are **fetched live** from `api.github.com/orgs/nmfs-ost/repos`,
filtered on the `AA-SI` prefix — the same match the org's own `?q=AA` link does —
and shown with the three facts that actually answer "is this the one I want":
what it is, what it is written in, and when anything last happened in it. A repo
last pushed to two years ago is a different answer from one pushed this morning,
and no button can say that.

Called from the browser, not proxied through the backend: the backend has no
outbound-network dependency today, and adding one for a link list would mean a
workstation with no egress fails to *start* rather than fails to show a panel.

**`FALLBACK_REPOS` in `config/resources.ts` is a floor, not a catalogue.** Every
entry cites its evidence in a comment. It exists so an air-gapped workstation, or
one that has hit GitHub's unauthenticated hourly limit, still has somewhere to
go — and the panel **says plainly** when it is showing that list rather than a
live one. Silently presenting a hand-maintained list as live is the failure mode
`toolCatalog.ts` already carries an ACCURACY WARNING about. Rate-limiting is
reported as itself rather than as a generic failure, because "wait an hour" and
"you are offline" call for different things from the reader.

### Read this before touching `identity.py`

The request was that certain options "should only execute according to email
assigned to the project". There is now a `/api/identity` endpoint and a
`state/identity.ts` store, and the UI gates on them — but:

> **This is not an authorization system and must never be mistaken for one.**

The Workbench runs *on* the user's own workstation, as that user. Every tool it
starts inherits their credentials, and **the terminal panel two clicks away is an
unrestricted shell**. A check in that file cannot stop anyone from doing
anything.

There are exactly two real boundaries and both are elsewhere:

- **GCP IAM**, for anything touching the bucket. `aa-upload` to a prefix you
  cannot write fails at Google's edge, correctly, whatever the UI says.
- **`AASI_FS_READONLY`**, for the filesystem, enforced in `files.py` on every
  mutating route.

So `capabilities` is a **prediction** of what those two will allow, offered so a
disabled button can explain itself instead of a job failing three minutes in with
a 403 from a service the user has never heard of. `enforced` is `False`, and
**a test pins it there** — a future change that flipped it without adding a real
boundary would be a lie the UI then repeats.

Configuration:

```
AASI_PRINCIPAL        override the detected account (tests, CI)
AASI_PROJECT_MEMBERS  comma-separated allowlist: full addresses, or @domain
AASI_FS_READONLY      already read by files.py; mirrored into capabilities
```

Detection order: env var, then `gcloud config get-value account`, then the
GCE/Cloud Workstation metadata server. Cached per process; both probes are on a
2 s leash because this is called while the shell paints its first frame.
`gcloud` prints the literal string `(unset)` on stdout with exit 0 when no
account is set, which is handled — taken at face value it lands in the UI as an
account named "(unset)".

Two defaults chosen deliberately:

- **No allowlist means everyone.** An allowlist defaulting to closed would lock a
  scientist out of their own workstation over a misconfigured environment
  variable.
- **Non-membership gates *project* actions only,** never the local filesystem.
  Whose machine this is has already been answered by them being logged into it,
  and a colleague helping at someone else's desk should not lose the file
  browser.

---

## 5. The pride palette

A fifth palette, `pride`, dark-based. Three rules did the work, because six
saturated hues and a legible instrument are not obviously compatible:

- **The neutrals stay neutral.** A near-black carrying only a trace of violet.
  With six hues on screen in an open file, a tinted chrome would leave nothing
  that is *not* colour, and the eye needs somewhere to rest.
- **The flag lives in the editor.** The six syntax slots have always been the one
  place this UI admits more than one hue. Five stripes go there directly,
  lightened for a dark background the way the NOAA palette lightens Process Blue.
  **Red is deliberately not a syntax slot** — red already means `status.error`
  everywhere here, and a red meaning "string literal" in one panel and "the run
  failed" in another is worse than a five-stripe editor.
- **The rainbow itself is a band, not a fill.** A gradient cannot be a token text
  is drawn in; it would fail every contrast rule in `theme.test.ts`, correctly.

That last point is the only structural change: a new token
`color.decoration.band`, which is whatever CSS `background` accepts. It is
**`transparent` in all four pre-existing palettes**, so the rule that renders it
(a 2px strip on the menu bar's outer edge) draws nothing at all in them — adding
a fifth palette changed the appearance of none of the other four. Three tests pin
this: the four are transparent, pride's is a gradient, and the band never equals
any value text is drawn in.

The palette passes the existing contrast suite unchanged — every threshold was
computed before a colour was written, not adjusted afterwards.

---

## Files

**New (15)**

```
backend/src/aa_si_workbench/api/            identity.py
backend/tests/                              test_identity.py
frontend/src/config/                        resources.ts
frontend/src/services/                      identityApi.ts  githubApi.ts
frontend/src/state/                         identity.ts
frontend/src/components/dialogs/            RenameDialog.tsx
frontend/src/components/panels/             RowMenu.tsx  rowFormat.ts
                                            terminalLinks.ts
frontend/src/components/panels/resources/   ResourcesPanel.tsx
frontend/src/components/panels/pipelines/   commandParser.ts
frontend/tests/    terminalLinks.test.ts  commandParser.test.ts  rowFormat.test.ts
```

**Modified (25)** — `api/files.py`, `api/main.py`, `filesApi.ts`, `FilesPanel`,
`DerivedPanel`, `TerminalPanel`, `NewPipelineDialog`, `PipelinesPanel`,
`state/editors`, `state/pipelines`, `state/activeSubject`, `useLayoutController`,
`DockLayout`, `SideBar`, `MenuBar`, `defaultLayout`, `panels/registry`,
`dialogs/registry`, `types/panels`, `types/dialogs`, `types/theme`,
`theme/tokens`, plus `tests/test_files.py`, `tests/layouts.test.ts` and
`tests/theme.test.ts`.

---

## Status, honestly

**Verified** — by typecheck, unit test, and a clean production build:

- every new `files.py` route, including the boundary cases: rename-as-path,
  move-into-own-subtree, trash name collision, a hand-edited `.trashinfo`
  pointing outside the root, and read-only refusal on all of them
- the command parser against real catalogue entries — quoting, `--flag=value`,
  multi-value splitting, and every path that causes a demotion
- link detection against transcribed tool output, including wrapped lines and
  the false positives (`and/or`, `38/120`, relative paths, a URL's own path)
- `formatRelativeTime` at all five boundaries, including a future timestamp
- all five palettes against the contrast suite, and the band's invisibility in
  the other four
- identity detection, the allowlist, and `enforced === false`

**Untested — written, never run against anything real.** This is the honest
headline and it has not changed in character from last session:

- **No part of this has run against a live backend.** Not one of the new
  endpoints has been called over HTTP; they are exercised as Python functions.
- **The trash has never been used on a real workstation.** In particular the
  cross-filesystem path (`shutil.move` when `$HOME` and the data are on different
  mounts) is written but unexercised, and a workstation with `AASI_FS_ROOT=/data`
  and a home trash elsewhere will move files *out of the browsable tree* —
  recoverable via Undo or a desktop Files app, but the tree will not show them.
- **The GitHub fetch has never succeeded here.** The sandbox hit the
  unauthenticated rate limit, so only the *fallback* path has been seen. The live
  path is inference from the API's documented shape.
- **`identity.py`'s metadata-server probe has never met a metadata server**, and
  the `gcloud` probe is tested only against a fake `subprocess.run`.
- **Terminal links have never been clicked**, because that needs a PTY. The
  parsing is well covered; the xterm wiring — the range coordinates in
  particular — is the part to watch, and a link landing one cell off would be
  the symptom.
- **No screenshot of the pride palette exists.** It is correct by computation,
  which is not the same as looking right.

**Known wrong / known incomplete**

- **The menus act on one row.** There is no multi-select, so trashing twenty
  files is twenty gestures. The tree has never had multi-select; adding it is a
  bigger change than it looks because it interacts with the filter and with lazy
  loading.
- **No Duplicate, and no drag-to-move.** `/api/fs/move` exists and is tested but
  has **no UI** — it was built because trash needs the same primitives and
  because the menu will want it. Nothing calls it yet.
- **The bucket has no Modified value for folders or stores.** GCS reports
  `updatedAt` on objects only; a common prefix has no timestamp, and a store
  listed as a leaf never enumerated its chunks. Those rows render blank rather
  than borrowing a plausible number.
- **The command parser does not round-trip.** Editing a structured stage in the
  Configuration panel and re-opening the New Pipeline dialog does not show the
  edited command; the dialog is a one-way builder.
- **The pride palette has no light variant.** Every other palette states a base;
  this one is dark only.

---

## What is still open

The previous handoff's **Next** list is untouched and still correct. Repeated
here so it does not get lost behind this session's work:

1. **Make sequence stages skippable, and add a short path.** A sequence that
   cannot express `aa-ed → aa-combine` is wrong for the common small job. This
   was *"the first thing to fix"* last session and still is.
2. **Run the sequence against real survey data, once, end to end.**
3. **A bucket to test against.** Publish, remote `aa-store`, and the derived
   listing fix are all unexercised, and all three touch credentials. This session
   added a fourth: the Derived panel's per-object console links.
4. **`aa-split`.**
5. **The Sv sector** (`aa-sv`, `aa-clean`, `aa-mvbs`), when the Zarr/NetCDF
   boundary is decided.

New, from this session:

6. **Point `AASI_PROJECT_MEMBERS` at the real project list** — or decide it
   should stay unset. It is currently unset, which means unrestricted, which is
   the right default but probably not the intended end state.
7. **Multi-select in the two trees**, which unblocks bulk trash and gives
   `/api/fs/move` a caller.

## What would help

1. **A GitHub token, or a run from an unthrottled address**, so the Project
   panel's live path can be seen working once.
2. **The list of AA-SI repositories that should appear**, if the `AA-SI` prefix
   match is not the right filter. `config/resources.ts` documents where each
   fallback entry came from.
3. Unchanged from last session: the remaining tool files (`aa-sv`, `aa-clean`,
   `aa-mvbs`, `aa-graph`, `aa-get`, `aa-recipe`), and which workflows besides
   NCEI survey assembly matter.

---

## Conventions worth not breaking

The previous handoff's two still hold — *a mode is a verb, never a variant of
one*, and *defaults are placeholders, not values* (the latter is why
`createPipeline` seeds values instead of rewriting defaults). Three more:

**Nothing here deletes.** Trash moves, and can be undone. If a Delete ever lands,
it should be a separate, differently-worded action — not a stronger version of
this one.

**A disabled action says why; a nonexistent one is absent.** Both browsers follow
this. The Bucket menu has no Delete *item*, because a disabled one promises the
feature is coming.

**The UI predicts, the boundary enforces.** `identity.py` predicts what IAM and
`AASI_FS_READONLY` will allow. Anything that starts treating it as the thing
granting permission has introduced a security hole shaped like a feature.
