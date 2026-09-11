const EVEN_SDK_EVENT_LOG = "[EvenAppBridge] EvenHub event:";

let ownerCount = 0;
let previousLog: typeof console.log | null = null;
let privacyLog: typeof console.log | null = null;

/**
 * The pinned SDK logs the complete decoded event, including microphone PCM.
 * Keep its API behavior intact while dropping only that exact diagnostic call.
 */
export function installEvenSdkEventLogPrivacy(): () => void {
  if (ownerCount === 0) {
    previousLog = console.log;
    privacyLog = function (...args: unknown[]): void {
      if (args[0] === EVEN_SDK_EVENT_LOG) return;
      previousLog?.apply(console, args);
    };
    console.log = privacyLog;
  }
  ownerCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    ownerCount = Math.max(0, ownerCount - 1);
    if (ownerCount !== 0) return;
    if (privacyLog && console.log === privacyLog && previousLog) console.log = previousLog;
    previousLog = null;
    privacyLog = null;
  };
}
