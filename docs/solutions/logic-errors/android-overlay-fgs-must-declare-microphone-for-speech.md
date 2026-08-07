---
title: "Android overlay FGS must declare microphone type for SpeechRecognizer"
date: 2026-08-07
category: logic-errors
module: companion/android
problem_type: logic_error
component: CaptureOverlayService
severity: high
issue: 166
applies_when:
  - "Hosting SpeechRecognizer (or any mic) inside a foreground service overlay"
  - "Targeting Android 14+ (API 34) with TYPE_APPLICATION_OVERLAY capture UI"
  - "Seeing Listening UI with no partials / silent mic / ERROR_SERVER_DISCONNECTED loops"
tags:
  - android
  - companion
  - speech
  - foreground-service
  - microphone
  - overlay
related_components:
  - "companion/android/app/src/main/java/app/tryatoms/capture/CaptureOverlayService.kt"
  - "companion/android/app/src/main/java/app/tryatoms/capture/speech/InAppSpeech.kt"
  - "companion/android/app/src/main/AndroidManifest.xml"
---

# Android overlay FGS must declare microphone type for SpeechRecognizer

## Problem

The Android companion hosts a capture strip as `TYPE_APPLICATION_OVERLAY` inside a
foreground service (`specialUse`). The UI showed **Listening…**, `startListening`
returned OK, and logcat even showed the system recognition service start — but
**no partials, no finals**, until the engine timed out or disconnected.

## Symptoms

- Mic permission granted (`RECORD_AUDIO: granted=true`)
- `AtomsSpeech: startListening ok` / segment start logs
- System side: AiAi / GoogleTTS recognition starts then CANCELLED / NO_SPEECH / code 11
- User-facing: "Listening…" with empty text box; later `Voice failed (11)`
- Typing + Save to Inbox still worked

## What didn't work

1. **On-device recognizer first** — `createOnDeviceSpeechRecognizer` preferred SODA offline path that dropped results after cancel races.
2. **Hard `cancel()` on every stop/restart** — discarded finals that arrived after teardown; treated as "voice broken."
3. **Assuming RECORD_AUDIO alone is enough** under an FGS — on API 34+ the service type gates mic access, not just the runtime permission.
4. **Treating ERROR 11 as fatal** — `ERROR_SERVER_DISCONNECTED` is a normal OEM binder drop mid-utterance during continuous dictation.

## Solution

### 1. Declare and promote the microphone FGS type

Manifest:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<service
    android:name=".CaptureOverlayService"
    android:foregroundServiceType="specialUse|microphone" />
```

Runtime: keep **specialUse** for the whole strip lifetime; **or in microphone** only while dictating:

```kotlin
ServiceCompat.startForeground(
    this, NOTIF_ID, notif,
    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or
        (if (mic) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0),
)
```

Order: promote FGS with mic type **before** `SpeechRecognizer.startListening`.

### 2. Live dictation, not dump-on-stop

- Stream `onPartialResults` into the text field (`onLiveText`)
- Auto-restart segments until the user hits stop
- Stop commits open partial and ends — does not wait for a final blob

### 3. Session generation against stale callbacks

`cancel()` on the old recognizer delivers `ERROR_CLIENT` to the **old** listener.
Without a generation token that schedules another restart and kills the new segment.

```kotlin
private var session = 0
// listener(gen) ignores callbacks when gen != session
// stop / beginSegment bumps session and clears pending restart Runnables
```

### 4. Soft vs hard errors

| Codes | Behavior |
|-------|----------|
| NO_MATCH, SPEECH_TIMEOUT, CLIENT, BUSY, **11 SERVER_DISCONNECTED**, 10 TOO_MANY_REQUESTS | Silent restart (cap soft restarts per session) |
| NETWORK, SERVER, AUDIO | Retry few times then failOut |
| INSUFFICIENT_PERMISSIONS | Fail with clear copy |

### 5. SAF inbox read must not silent-empty

`readText` catching → `""` then `writeSafFull(..., "wt")` **wipes** Inbox.md on transient provider failure. Use `readTextOrThrow`; only empty after a successful read.

## Why this works

Android 14's FGS type system is a **capability grant**, not documentation. A
`specialUse` service without `microphone` may start SpeechRecognizer but does not
get usable audio. Declaring the type at the moment of mic use matches platform
policy and unblocks the engine.

Continuous dictation plus generation-guarded restarts matches how OEM engines
actually behave (short segments, binder drops) without surfacing noise to the user.

## Prevention

- Any new mic-using FGS: checklist **permission + FGS type + startForeground type bitmask + order before startListening**.
- Dogfood voice on a fresh install (permissions reset) on API 34+ hardware, not only emulator.
- Never map failed SAF/content reads to empty string before a truncating write.
- Unit-test file-mode atomic write; instrument SAF wipe path when possible.
- Log `onError code=` with session gen so stale vs live is obvious in logcat.

## Related

- iOS Shortcut wire format: `docs/solutions/documentation-gaps/ios-shortcut-capture-wire-format-traps.md`
- Issue #166 / PR #362 Android companion capture POC
