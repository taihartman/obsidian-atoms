/** Scoped English catalog for the Even G2 plugin surface. */
export const G2_EN = {
  connect: {
    name: "Even G2",
    signedOut: "Sign in to Atoms Plus to connect Even G2.",
    unavailable: "Atoms Plus required.",
    description: "Create a short-lived code, then enter it in the Atoms app on your glasses.",
    rowDescription: (ready: boolean) => `${ready ? "Ready" : "Setup required"}. Create a short-lived code, then enter it in the Atoms app on your glasses.`,
    label: "Get code",
    codeCopied: (code: string) => `G2 code ${code} copied. Enter it on your glasses before it expires.`,
    codeVisible: (code: string) => `G2 code: ${code}. Enter it on your glasses before it expires.`,
    failed: (message: string) => `Even G2: ${message}`,
  },
  status: {
    ready: "Ready",
    setupRequired: "Setup required",
    setupDescription: "Finish the G2 disclosure, Ask mirror consent, and connected-app write consent before your glasses can send or read atom content.",
    checking: "Checking connected glasses…",
    unavailable: "Could not check connected glasses. Try again in a moment.",
    none: "No G2 glasses connected yet.",
  },
  devices: {
    heading: "Connected glasses",
    refresh: "Refresh",
    disconnectLabel: "Disconnect",
    lastSeen: (day: string) => day ? `Last seen ${day}` : "Not seen yet",
    rowDescription: (day: string, ready: boolean) => `${day ? `Last seen ${day}` : "Not seen yet"}. ${ready ? "Ready" : "Setup required"}.`,
    pending: (count: number) => `${count} confirmed ${count === 1 ? "atom is" : "atoms are"} still waiting for the paired vault. Disconnecting keeps ${count === 1 ? "it" : "them"} queued.`,
    confirmTitle: (name: string) => `Disconnect ${name}?`,
    confirmBody: (name: string, pending: number) => pending > 0
      ? `${name} will stop connecting. ${pending} confirmed ${pending === 1 ? "atom stays" : "atoms stay"} queued for the vault. The Ask mirror and other connected apps stay as they are.`
      : `${name} will stop connecting. The Ask mirror and other connected apps stay as they are.`,
    cancel: "Cancel",
    confirm: "Disconnect",
    disconnected: (name: string) => `${name} disconnected.`,
  },
  consent: {
    writeRow: "Allow filing from Claude or ChatGPT",
    writeDescription: "When on, this vault applies new atom bodies queued by connected apps, including Claude, ChatGPT, and Even G2. New files only. Existing bodies are never rewritten. Requires Ask mirror enabled.",
    writeDisclosure: "Connected apps, including Claude, ChatGPT, and Even G2, can queue new atom bodies to Atoms Plus, and this vault will write them as new files under my Atoms folder. New files only. Existing bodies are never rewritten. This is separate from the Ask privacy acknowledgment, and turning it off stops the writes without touching the mirror.",
    regrantRequired: "A newer withdrawal reached Atoms Plus. Review the current consent and turn it on again if you still want connected apps to write here.",
  },
} as const;

export type G2Locale = typeof G2_EN;
