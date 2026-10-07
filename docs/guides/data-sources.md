# Data sources: where Prepare EchoData's raw files come from

NCEI is one source of raw files among several. Prepare EchoData's first step
starts with **Source**:

| Source | What it is | How its files are fetched |
| --- | --- | --- |
| **NCEI** | NOAA NCEI's public water-column archive (`noaa-wcsd-pds`), listed from its S3 bucket or the project's BigQuery cache. Built in, always connected. | `aa-fetch`, as before |
| **OMAO** | NOAA Office of Marine and Aviation Operations: the fleet's own archive. Built in, *not connected* until you say where its files are. | `aa-download` (a bucket) or `cp` (a folder) |
| **An archive you add** | Any folder of raw files laid out by vessel, survey and echosounder. | `aa-download` or `cp` |

Every source answers the same four questions, so the rest of the card works
the same for all of them:

1. which vessels;
2. which surveys of a vessel;
3. which echosounders of a survey;
4. which raw files, with their sizes and times.

The products go to the same place in the bucket whatever the source:
`derived_products/<you>/<vessel>/<survey>/<asset>/`.

## Connecting OMAO, or adding an archive

**Sources…** (beside the Source field) lists the sources and what each is
connected to.

To connect OMAO:

1. Choose **Connect…** beside it, or the *Connect OMAO…* link that shows when
   OMAO is chosen but not connected.
2. Say where its raw files are:
   - a bucket folder, `gs://bucket/folder`, listed with your Google credentials
     (the ones the console tools use) and fetched with `aa-download`; or
   - a folder on the workstation (a mounted share, say), `/mnt/omao/raw`, which
     is copied with `cp`. While the Workbench listens on more than this machine,
     a folder can only be named this way if `AASI_ALLOW_REMOTE_FS=true` (the
     Files panel's rule); a deployment's `AASI_SOURCES_FILE` can always name
     one.
3. If the folders below it are not `<vessel>/<survey>/<echosounder>/`, change
   **Folders below it**. Use names, and `{vessel}`, `{survey}`, `{sonar}` in that
   order, for example `data/raw/{vessel}/{survey}/{sonar}`. An archive without
   a folder per echosounder names its echosounder instead (EK80, say). The
   dialog shows where a file would be.

**Add an archive** does the same for a new source, with a name of its own.

When you save, the location is checked and the source becomes the one in use.
The folder names are the ones you then choose from: vessel folders such as
`Henry_B._Bigelow` show as *Henry B. Bigelow*. The raw files' times come from
their names (`…D20160703-T060000.raw`), as for NCEI.

## Where it is kept

What you set is kept per user on the workstation, in
`~/.config/aa-si-workbench/sources.json`. A deployment can name sources for
everyone in a file of its own, given as `AASI_SOURCES_FILE`. It uses the same
format, and the user's file is read on top of it:

```json
{"sources": [
  {"id": "omao", "root": "gs://omao-raw/fleet"},
  {"id": "shimada", "name": "Shimada share", "kind": "archive",
   "root": "/mnt/shimada/raw", "layout": "{vessel}/{survey}/{sonar}"}
]}
```

An entry with a built-in's id (`omao`) sets that source's location. Any other
id adds a source. **Disconnect** or **Remove** in the dialog takes your entry
away, and the deployment's, if there is one, applies again.

## Wiring in another kind of source (developers)

The sources live in `backend/src/aa_si_workbench/api/sources.py`.

- A source *kind* is a provider class with five methods:
  - `list_vessels()`, `list_surveys(vessel)`, `list_sonars(vessel, survey)` and
    `list_raw_files(vessel, survey, sonar)`, returning the `Vessel`, `Survey`,
    `SonarModel` and `RawFile` models NCEI uses;
  - `locations(vessel, survey, sonar, names)`, returning where each raw file
    is, as a `gs://` URI or a path.
- Register the class in `KINDS`. A source of that kind can then be listed in
  `sources.json` with `"kind": "<your kind>"`.
- The kinds today are `ncei` and `archive`. An API or a database is one more
  entry.
- Prepare EchoData's fetch copies the files from `locations()`:
  `aa-download` for `gs://` URIs, `cp` for paths (`baseline._copy_from_source`).
  NCEI is the exception: `aa-fetch` finds its files from the request document.

The routes:

| Route | What it does |
| --- | --- |
| `GET /api/sources` | List the sources. |
| `PUT /api/sources/{id}` | Connect a source or add one. |
| `DELETE /api/sources/{id}` | Disconnect or remove one. |
| `GET /api/sources/{id}/vessels`, `/surveys`, `/sonars`, `/files` | Answer the four questions. |

`/api/ncei/*` still answers for NCEI. The frontend side is
`services/sources/sourcesApi.ts`, `state/prepare.ts` (`selectSource`,
`saveSource`) and `components/panels/prepare/SourcesDialog.tsx`. Tests:
`backend/tests/test_sources.py`.

The OMAO tab that used to sit in the left dock is gone; OMAO is a source here.
