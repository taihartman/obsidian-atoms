export function appHasDailyNotesPluginLoaded(): boolean {
  return true;
}
export function getAllDailyNotes(): Record<string, unknown> {
  return {};
}
export function getDateFromFile(): null {
  return null;
}
export function getDailyNote(
  _date: unknown,
  _notes: Record<string, unknown>,
): null {
  return null;
}
export async function createDailyNote(_date: unknown): Promise<{
  path: string;
}> {
  return { path: "Quick Notes/test-today.md" };
}
