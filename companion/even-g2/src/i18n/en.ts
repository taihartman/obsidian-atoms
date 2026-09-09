export const CREATE_COPY = Object.freeze({
  confirm: (title: string) => `Create “${title}”?`,
  queued: "Queued",
  saved: "Saved to Atoms",
  waiting: "Waiting for a connection",
  collision: "That title already exists",
  revoked: "Connect G2 again",
  rejected: "Could not save this atom",
});
