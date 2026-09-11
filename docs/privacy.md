# Atoms privacy boundaries

Atoms keeps the vault as the source of truth. The Even G2 companion adds a private cloud path, but it does not change that rule.

## Even G2

The glasses send microphone audio to Atoms Plus only after you choose a voice action and accept the current disclosure. Atoms Plus sends that audio to its dedicated transcription provider. For atom preparation and grounded questions, Atoms Plus sends the transcript or bounded mirror excerpts to its dedicated language-model provider.

Captured words stay verbatim when an atom is created. Model output is limited to a title, existing tags, reason-bearing links, or an answer grounded in quoted mirror evidence.

G2 tickets expire after seconds and can be used once. Completed transcripts are encrypted with account and record binding and retained for no more than 24 hours. Atom preparations expire after 15 minutes. Successful local recovery data is deleted after the confirmed receipt. Expired service and local recovery data is removed by bounded sweepers.

On iPhone, the private v1 is session-only because the Even Hub host may discard IndexedDB when its process restarts. Access tokens remain memory-only, and a restart that loses the device credential requires pairing again. Local audio and proposal recovery are also lost, so an interrupted recording cannot be resumed after that restart. Atoms does not replace this protection with a bearer-token fallback.

Operators record counts, durations, status classes, and latency. Logs and metrics do not contain microphone audio, transcripts, questions, atom bodies, raw tokens, account emails, device identifiers, or provider credentials.

Disconnecting G2 revokes its device family and clears its pending work. It does not delete the Ask mirror or disconnect other apps. Wiping the Ask cloud copy remains a separate action.

The G2 service is disabled by default. Public Even Hub availability remains blocked until the private package, Beta, and physical-glasses checks in [`g2-private-test.md`](g2-private-test.md) are recorded.
