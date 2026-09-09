export function truncateUtf8(value: string, maximumBytes: number): string {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new Error("invalid_byte_limit");
  const encoder = new TextEncoder();
  let result = "";
  for (const character of value) {
    if (encoder.encode(result + character).byteLength > maximumBytes) break;
    result += character;
  }
  return result;
}

export function paginateUtf8Text(text: string, characterBudget = 450): string[] {
  if (!Number.isSafeInteger(characterBudget) || characterBudget < 1) throw new Error("invalid_page_budget");
  if (text.length === 0) return [""];
  const pages: string[] = [];
  let current = "";
  for (const character of text) {
    if (current.length + character.length > characterBudget && current.length > 0) {
      pages.push(current);
      current = "";
    }
    current += character;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}
