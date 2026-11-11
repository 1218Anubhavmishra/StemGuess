/** A player's name as shown: every word starts with a capital and goes on in small letters ("anu SHARMA" → "Anu Sharma"). */
export function titleCase(name: string): string {
  return name.toLocaleLowerCase().replace(/(^|[\s\-'’.])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toLocaleUpperCase());
}
