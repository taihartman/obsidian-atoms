---
title: "A permission you drop still inherits the state it wrote"
date: 2026-08-07
category: architecture-patterns
module: companion-android
problem_type: design_error
component: capture-vault-link
severity: high
status: solved
tags:
  - android
  - product-flavors
  - capability-seam
  - shared-preferences
  - permissions
  - play-store
  - upgrade-path
---

## Context

Shipping **Atoms Capture** to Google Play meant dropping `MANAGE_EXTERNAL_STORAGE`. Play grants
all-files access only to file managers, backup, and antivirus apps, so the store build cannot have
it. The split (#382) was two product flavors behind one seam:

- `play` — SAF folder picker only. `FileTreeAccess.SUPPORTED = false`.
- `sideload` — keeps all-files access and the file-tree scan. `FileTreeAccess.SUPPORTED = true`.

`VaultLocator`, the scanner, moved into `companion/android/app/src/sideload/`, so a `play` build that tries to scan
the phone does not compile. That felt airtight. It was not.

## Guidance

**A compile-time seam only governs the code in this build. It says nothing about the state a
previous build left on the device.** Enforce the capability where the state is *read*, not only
where the code is *linked*.

Both flavors share an `applicationId`, so installing the Play build over a sideload or POC one is
an in-place upgrade and `SharedPreferences` survives it. The old build had written an absolute
vault path. The new one had no permission to read it, and no code path that could tell:

```kotlin
// VaultStore.State — a stored path alone means "linked"
val vaultLinked: Boolean
    get() =
        !vaultAbsolutePath.isNullOrBlank() ||
            (accessRootUri != null && vaultRelativePath != null)
```

```kotlin
// CaptureRepository.append — and the stored path wins
val abs = vault.vaultAbsolutePath
return if (!abs.isNullOrBlank()) {
    writer.appendCaptureToVaultPath(abs, body)   // unreadable in the play build
} else { /* SAF path */ }
```

So the hub said *"VaultOne. Captures go to Atoms System/Inbox.md"* while every save failed against
a path the build could not touch. Switch was a no-op. Nothing pointed at the real problem.

The fix reads the seam at the point of load, so the illegal state cannot be constructed:

```kotlin
// VaultStore.read()
vaultAbsolutePath =
    linkedAbsolutePath(prefs.getString(KEY_ABS, null), FileTreeAccess.SUPPORTED),

// VaultStore.Companion
fun linkedAbsolutePath(
    stored: String?,
    fileTreeSupported: Boolean,
): String? = if (fileTreeSupported) stored else null
```

`vaultLinked` then reads false, the hub asks for a folder, and the widget, tile, and overlay get
the correction for free because they all read the same store. The stored value is left on disk
rather than deleted, so moving back to a sideload build restores the link.

Taking the flag as a **parameter** rather than reading the constant inline is what makes it
testable — a single unit test covers both flavors, and it fails without the fix:

```kotlin
assertNull(VaultStore.linkedAbsolutePath("/storage/…/Remote Vault", fileTreeSupported = false))
```

## Why This Matters

The compile-time seam is genuinely good — it is the "make illegal states unrepresentable" rule
working — but it only spans the boundary it can see. Persisted state crosses that boundary in one
direction the compiler never checks: **time**. Anything durable that a prior build wrote is
untrusted input to the current build's capability model.

The failure mode is the worst kind: the app looks healthy and loses data silently. The user has no
symptom to report beyond "my captures stopped arriving", and the one control that looks like a fix
(Switch) does nothing.

Note that no reviewer reading only the diff would find this. It surfaced from an adversarial pass
asking specifically what a *previous install* leaves behind — the diff shows the new world, not
the upgrade into it.

## When to Apply

Any time a build variant, feature flag, entitlement, or subscription tier **removes** a capability
that a previous state of the app had:

- Android product flavors that share an `applicationId` (prefs, DataStore, Room, files all survive)
- A permission the user revokes in system settings after granting it
- A downgrade from a paid tier that leaves paid-only configuration behind
- A remote flag flipped off while a device holds state written while it was on

Ask two questions:

1. **What did a build with this capability persist?** Enumerate the keys, not the code paths.
2. **What does the state mean when the capability is gone?** If the honest answer is "nothing", the
   read must return nothing. A capability check at the write site does not help — the write already
   happened, in a different build.

## Examples

Same seam, both halves:

```kotlin
// Compile time — play cannot even reference the scanner
// companion/android/app/src/play/java/app/tryatoms/capture/data/FileTreeAccess.kt
object FileTreeAccess {
    const val SUPPORTED: Boolean = false
    fun granted(): Boolean = false
    fun discover(): List<DiscoveredVault> = emptyList()
}
```

```kotlin
// Read time — play cannot honor state that assumed the scanner
vaultAbsolutePath = linkedAbsolutePath(prefs.getString(KEY_ABS, null), FileTreeAccess.SUPPORTED)
```

The second one is the one that was missing, and the one the user would have hit.

**Verified on an emulator, both directions:** seed a file-path link, confirm the sideload build
reports it linked, `adb install -r` the play build over it without uninstalling, and confirm the
hub falls back to the folder picker instead of claiming a vault.

## Related

- The build-time guard for the other half of this change: `VerifyPlayManifest` in
  `companion/android/app/build.gradle.kts` parses the **merged** manifest and fails the build if
  broad storage or `INTERNET` comes back from any library. A silent-pass guard gets mutation-proved
  by hand before it is trusted.
- [A test harness that cannot fail reports coverage that never ran](a-test-harness-that-cannot-fail-reports-coverage-that-never-ran.md)
- [#384](https://github.com/taihartman/obsidian-atoms/issues/384) — the companion app has no CI, no
  Compose UI tests, and untestable build logic, which is why both bugs here were caught by review
  and hand-driven emulator runs rather than by a suite.
