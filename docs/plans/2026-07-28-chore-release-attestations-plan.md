# Plan: CI release + artifact attestations

**Issue:** #169  
**Lane:** light  
**Done when:** tag push builds assets in Actions, attaches them + `SHA256SUMS.txt`, and records build provenance attestations.

## Understanding

Releases today are laptop-built `main.js` / `manifest.json` / `styles.css` uploaded to GitHub. Security review (P3 / H9) and GitHub’s attestation recommendation both want CI-built, verifiable provenance.

## Approach

1. Add `.github/workflows/release.yml` on version tags (`0.6.x`).
2. `npm ci` → version check (tag = package = manifest) → `npm test` → `npm run build`.
3. Write `SHA256SUMS.txt`; attest all four files with `actions/attest-build-provenance`.
4. Publish via `softprops/action-gh-release` (same asset names BRAT expects).
5. Document verify command + cut-release flow in README; mark security review row done.

## Blast radius

- **Human release process changes:** bump versions on master → tag → push tag (no local `main.js` upload).
- BRAT asset names unchanged.
- No plugin runtime code.
- First real proof is the next intentional version tag after merge.
