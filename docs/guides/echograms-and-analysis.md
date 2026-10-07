# Echograms, lines and regions, calibration, integration

The Workbench's Echoview-style work happens in five panels. Each one runs
AA-SI console tools from aalibrary on products in the bucket and shows what
they wrote. Nothing is changed in place: a line, a calibration or an
integration is a new product with its own hash, beside the data it belongs to.

| Panel | Tools it runs | What it writes |
|---|---|---|
| **Echogram** | `aa-tiles`, `aa-annotate` | a tile pack (`.tiles`); line (`.evl`) and region (`.evr`) files |
| **Calibration** | `aa-ecs`, then `aa-sv --ecs` | an Echoview calibration supplement (`.ecs`); an Sv |
| **Pipelines → Integrate (Echoview)** | `aa-integrate` | a CSV with Echoview's export columns |
| **Results** | (reads the CSV) | |
| **Dataflow** | (reads the records) | |

## Echogram

Open one from **Products**: right-click an Sv, MVBS, TS or mask and choose
**Open as echogram** (a run's products have the same button). The first time,
`aa-tiles` makes a tile pack beside the product, which takes a few seconds per
hour of data; after that it opens at once, for anyone.

- **Moving around.** Wheel to zoom (Shift: time only, Alt: depth only), drag
  to pan, **Z** for a zoom box, **F** for everything. The channels are drawn
  one above the other; the chips in the toolbar hide or show each.
- **Colours.** The choices:
  - *The theme's* colormap. This is the default. It is EK500 except under a
    colormap theme (see below).
  - EK500, Echoview's default.
  - One of Matplotlib's colormaps: viridis, plasma, inferno, magma, cividis,
    turbo, jet, ocean, cubehelix or gray. These are Matplotlib's own tables,
    so the viewer draws an Sv in exactly the colours `aa-graph --cmap` draws it
    in.

  Then a minimum and maximum in dB (arrow keys nudge them), and below the
  minimum either the background or the weakest colour. *Auto* uses the data's
  2nd and 98th percentiles. Sv starts at Echoview's familiar −70 to −34 dB.
- **Readout.** The bar at the bottom gives the time, ping, depth, value,
  position and any lines or regions under the cursor.
- **Track.** The side panel maps where the data were collected:
  - The coastline (Natural Earth, served by the Workbench itself) and a
    latitude/longitude grid.
  - The whole track, with the stretch on screen marked. The ship's heading is
    shown at the end, and the ping under the cursor as a ring.
  - Below the map: the ship and survey (from where the product sits in the
    bucket), when, how far and how fast.

  Click the track to go to that ping. The ⤢ button opens a larger map:
  - Zoom from the whole world down to the ship's wake, and drag to pan.
  - Colour the track by time, in the theme's colormap.
  - A world inset shows where the map is.
  - Beside the map: start and end times and positions (degrees and decimal
    minutes), duration, distance sailed, mean speed, the extent, the stretch
    on screen, and the ping under the pointer.

  Jumps faster than 40 knots (GPS glitches) are not counted in the distance.

### Colormap themes

**View ▸ Viridis / Plasma / Inferno / Magma / Cividis / Turbo / Jet Theme
(Matplotlib)** makes one colormap the scheme for the whole Workbench. Each
theme:

- Draws the interface from that colormap: the dark end tints the chrome, the
  accent and the editor's colours come from the colormap, and a band of it
  runs under the menu bar.
- Draws echograms in that colormap by default (*The theme's* above).
- Makes *The theme's* the colormap for the echogram Prepare EchoData draws
  (`aa-graph --cmap`).
- Offers that colormap first for a pipeline's `aa-graph` (**Configuration ▸
  Colormap**, which shows each colormap as a swatch).

The themes are generated from Matplotlib by `scripts/build_colormap_themes.py`
and checked for contrast like the other themes. Run the script again when
Matplotlib's tables change; a backend test fails until you do.

### Lines

A detected bottom (Pipelines → **Bottom line to edit**, which runs
`aa-detect-seafloor` and `aa-annotate`) opens with its echogram. To correct it,
make it the active line (the radio button beside it) and use the **line pick**
tool (**L**): draw over a stretch of the line and that stretch is replaced by
what you drew. **S** selects a point to drag; *Shift line* moves the whole line
up or down. **Save** writes a new `.evl` beside the data; the old one stays and
is listed as an older version. **+ Line** starts a new line, a surface
exclusion line for instance.

A line too long to edit in the browser (more than 200,000 points) is shown
thinned and is not editable here.

### Regions

**+ Regions** starts a region layer. Draw rectangles (**R**) or polygons
(**G**: click the corners, double-click or Enter to close). Select one (**S**) to
give it a name, a class (the species, say) and a type: *Analysis* regions are
integrated by region, *Bad data* is left out of integration, *Marker* is a
note. **Save** writes an `.evr`.

Lines and regions are Echoview's own formats (EVL and EVR): Echoview, echopype
and echoregions read them, and files from Echoview can be copied into the
bucket and used the same way.

## Calibration

Select an EchoData (or an Sv made from one) in Products and open
**Calibration**. It shows, channel by channel, the value in the file and the
value echopype will use to compute Sv, as echopype reads them. Type new values
in the *New* column (temperature, salinity, pressure and pH are one value for
every channel) and press **Save as ECS**: every value of every channel is
written to a new `.ecs` file beside the EchoData. **Compute Sv** then runs
`aa-sv --ecs` with it (the run shows in Pipelines). The ECS is an input of the
Sv, so its content is in the Sv's product hash: two Sv files made with
different calibrations never share a hash.

*Start from* chooses the file's own values or any ECS already saved. EK80 data
also needs its waveform and encoding modes.

## Integration and results

Pipelines → **Integrate (Echoview)** integrates an Sv the way Echoview's
*Integrate by cells* does: 0.5 nmi intervals (5 minutes when there is no
position), 10 m layers, a −70 dB threshold, and Echoview's export columns
(`Sv_mean`, `NASC`, `ABC`, `PRC_NASC`, …). In **Configuration**, choose a
bottom line (and an offset), a surface line or depth, bad-data regions, and, to
integrate by region, the analysis regions: each of these options lists the
matching products beside the input, or takes any gs:// URI.

Open the CSV with **Open results** (on the run's product, or right-click it in
Products). **Results** shows NASC along the track per interval for one
frequency, summed over its layers (for a region-cell export, the regions' share
of each cell, `PRC_NASC`), and every row, sortable.

## Dataflow

**Dataflow** (right dock; or right-click a product → *Show its dataflow*) draws
what the selected product was made from, up to the raw files, and what was made
from it. A product made with a line, region or calibration file that has been
saved again since is marked **out of date**, and so is everything made from it:
run its pipeline again with the new file chosen.
