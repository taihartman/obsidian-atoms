# Ask write path dogfood (0.6.35)

**Issue:** #127 · **Plan:** `docs/plans/2026-07-27-003-feat-ask-write-path-plan.md`

## Product loop (not fixture theater)

1. Plus signed in · Ask privacy ack · **Enable Ask mirror** · **Allow filing from Claude**
2. Sync now (mirror has parent if testing continue)
3. Claude connector → `create_atom` → tool returns **pending** + outbox_id
4. Open Obsidian (or wait ≤60s) → Notice “Ask: landed N atom(s)”
5. File under Atoms/ with `generated-by: ask-mcp` · appears in Library
6. Claude `fetch_atom` succeeds after land
7. **Continue:** `continue_atom` on mirrored parent → child links parent · parent bytes unchanged
8. Collision: same title different body → reject · existing untouched
9. Wipe → pending outbox gone · tokens revoked · vault files remain

## Agent vault

Use `test_vault/` only for unattended apply. Label any seed as plumbing.

## Automated

```bash
cd plus-service && npm test
npm test -- --run test/askOutbox.test.ts
npm run build
```
