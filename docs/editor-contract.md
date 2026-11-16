# The Social Club editor contract

Everything here is an **observed, unofficial contract**. It was measured on the live editor in November 2026 (build `20261031cgjfchh`) and written down in the Crest Forge build specification. Rockstar can change their site at any time. The single source of truth in code is `src/socialclub/editor-contract.ts`; change the two together.

> Status: the values below come from the specification. They have not been re-measured from this repository yet. Run the check at the bottom of this page before the first release.

The editor lives at `https://socialclub.rockstargames.com/emblems/new` (or `/emblems/new/<id>` from a crew page's Edit crew emblem link). It is a jQuery + Raphaël (SVG) app bundled with webpack.

## Canvas and limits

| Constant     | Value                | Notes                                                                                   |
| ------------ | -------------------- | --------------------------------------------------------------------------------------- |
| Canvas       | 512 × 512            | Same as the Crest Forge canvas, so no rescaling                                         |
| `LAYERS_MAX` | 750                  | Background layer not counted. Crest Forge aims for 740                                  |
| Scale        | 5% to 500% in the UI | On load only values below 1% are clamped, so 1% to 500% is safe                         |
| Rotation     | 0 to 359°            | Fractional values render fine                                                           |
| Opacity      | integer 0 to 100     | Per layer                                                                               |
| Save payload | 1,048,576 characters | `svgData` + `layerData`, both base64. Above it: "SAVE FAILED: Your emblem is too large" |
| Text         | removed              | Adding a text layer throws; text must become shapes                                     |

### Save size

`layerData = base64(JSON.stringify(layers))` and `svgData = base64(canvas SVG)`. Measured per layer: the SVG element is about `330 + 1.2 × path length` characters and the layer JSON about `400 + name length`, so

```
bytes ≈ 4/3 × (742 + 1.2 × pathLength + nameLength)
```

Library path lengths range from 32 to 65,001 characters (median 558). A simple primitive costs about 1.1 KB per layer; a median library shape about 1.9 KB. Crest Forge budgets 960,000 characters for automatic shape counts and warns above 95% of the limit.

## Layer record

```json
{
  "id": "s793445082189522700",
  "name": "01 2",
  "slug": "angles/01",
  "type": "path",
  "x": 292,
  "y": 276,
  "width": 299.71,
  "height": 300,
  "scaleX": 25,
  "scaleY": 25,
  "rotation": 130,
  "opacity": 100,
  "invertedX": false,
  "invertedY": false,
  "index": 0,
  "color": "#ffffff",
  "isFilled": true,
  "internal": false,
  "locked": false,
  "borderColor": "#a1a1a1",
  "borderSize": 0,
  "gradientStyle": "Fill",
  "tBold": false,
  "tItalic": false,
  "fontFamily": null
}
```

- `slug` is `<group>/<name>`; `width`/`height` are the shape's native box, copied from the library.
- A flipped layer stores `invertedX: true` and a negative `scaleX` (same for Y).

## Transform

Each layer is drawn on its native path with the Raphaël transform `T{x},{y} R{rotation},{x + w/2},{y + h/2} S{scaleX/100},{scaleY/100}`. In Canvas 2D terms:

```js
ctx.translate(x + w / 2, y + h / 2);
ctx.rotate((rotation * Math.PI) / 180);
ctx.scale(scaleX / 100, scaleY / 100);
ctx.translate(-w / 2, -h / 2);
ctx.fill(path);
```

So a shape with centre `(cx, cy)`, canvas size `(W, H)` and angle `θ` is `x = cx − w/2`, `y = cy − h/2`, `scaleX = 100·W/w`, `scaleY = 100·H/h`, `rotation = θ mod 360`.

## Modules

Module ids change with every build, so the scripts find modules by their exports:

| Module        | Detected by                     | Used for                                                                                            |
| ------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| Layer manager | `add`, `removeAll`, `getLayers` | `add(slug, data, false, false, callback)`, clearing, counting                                       |
| Group loader  | `loadGroups`, `initObjects`     | `loadGroups(['emblems/shapes/<group>', …], callback)`                                               |
| Shape library | `library`, `create`             | `library[slug]` = `{name, slug, type, path, width, height, groups}`; `groups` lists the group names |

## Quirks

- **Whole-pixel rounding.** On creation the editor stores `Math.round(x)`. The scripts set `x`, `y`, `rotation` and `_rotation` to the exact values in the `add` callback and call `draw()`.
- **`x + y = 0` is skipped.** `move` returns early when the sum is zero; the same callback fixes it.
- **Cyan handles** on the active layer are editor UI, not part of the emblem.
- **Save is not publish.** Saving adds to My Emblems; publishing sets the crew emblem. The scripts do neither.
- **Decimal positions.** Rockstar's own layers use integers. Decimals have rendered and saved fine in testing; the Export tab has a "round positions" fallback.

## Primitives

The only editor geometry the app carries, for the exact preview:

| Slug                                | Native box | Geometry                                                                            |
| ----------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `rectangles/square`                 | 300 × 300  | Full square (type `rectangle`, no path)                                             |
| `rounds/01`                         | 300 × 300  | Circle, radius 150                                                                  |
| `angles/03`                         | 159 × 300  | Isosceles: base (0, 300) to (158.91, 300), apex (79.457, 0)                         |
| `angles/05`                         | 192 × 300  | Right triangle: right angle at (192, 300), legs to (0, 300) and (192, 0)            |
| `polygons/04`                       | 300 × 260  | Flat-top hexagon: (75, 0) (225, 0) (300, 129.9) (225, 259.8) (75, 259.8) (0, 129.9) |
| `rounds/67`, `68`, `69`, `70`, `13` | 300 × 300  | Rings, hole/outer ratio 0.9933, 0.9667, 0.9333, 0.8333, 0.3183                      |
| `rounds/14`                         | 288 × 288  | Ring, ratio about 0.4887                                                            |

## Assumptions that still need measuring

These are not in the specification; Crest Forge had to choose a value. Each is isolated in `editor-contract.ts` or a template constant.

| Assumption                                                   | Value used                                                                | Where                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------- |
| Path length of the six ring shapes (for the size estimate)   | 600 characters each                                                       | `PRIMS[...].pathLen`, flagged `pathLenAssumed` |
| Effective path length of a shape without a path (the square) | 67 characters                                                             | `NO_PATH_LEN` in both templates                |
| `type` of a layer record                                     | copied from the library entry, `path` if absent                           | both templates                                 |
| `Shapes.groups`                                              | an array of names, an array of `{slug\|name}`, or an object keyed by name | trace template                                 |
| A library entry's `groups`                                   | array of group names; the slug prefix is used as well                     | trace template                                 |

## Re-measuring: `pnpm contract:check`

```bash
pnpm contract:check
```

writes `dist-tools/contract-check.js`. Sign in yourself, open the editor with a **throwaway** emblem (never your crew emblem), optionally import a design, then paste the file into the console. It prints a table: module discovery, each primitive's box and outline, ring ratios by ray-casting at 15° steps, and the save-size estimate against the payload the editor would send for the canvas as it is. The size check fails above 5% error.

The snippet is read-only. It never saves, publishes, clicks or sends anything; Crest Forge does not handle credentials, so this step cannot be automated in CI.

To grow the calibration set, save the printed JSON as `tests/fixtures/payloads/<name>.json` in the form `{ "layers": [packed layers…], "payloadLength": n }`; `tests/size.test.ts` then holds the estimator to 5% for every fixture.

## Manual release check

On the real editor, with a throwaway emblem:

1. Import a design that uses every shape type. Check place, size, rotation and flips.
2. Zoom to 175%: no hairline cracks in opaque triangulated shapes, rings or text.
3. Run the trace script with Auto. It stops before 740 layers and before the save budget.
4. Click Save yourself. It must succeed and appear in My Emblems; the crew emblem must be unchanged.
5. Reopen the saved emblem and compare. Delete the test emblem.
