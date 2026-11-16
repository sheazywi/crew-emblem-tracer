# Real save payloads

Calibration data for the save-size estimator. This folder is empty on purpose: payloads can only be measured in a signed-in editor tab, which this project never automates.

To add one, run `pnpm contract:check`, follow docs/editor-contract.md, and save the result here as `<name>.json`:

```json
{ "layers": [["rounds/01", 106, 106, 25, 25, 0, 100, "#ffffff", false, false, "c0"]], "payloadLength": 1104 }
```

`tests/size.test.ts` then requires the estimate to be within 5% of `payloadLength` for every file. The spec asks for 10 fixtures before release.
