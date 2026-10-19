/**
 * Comment mentions (M2.6): `@Full Name` resolved against the project's
 * members, longest name first so "@Ana Putri" beats "@Ana".
 */
export type Mentionable = { id: string; name: string };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function mentionPattern(names: string[]): RegExp | null {
  const known = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length).map(escapeRegExp);
  if (known.length === 0) return null;
  return new RegExp(`(?<=^|[\\s(])@(${known.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
}

/** Ids of the members mentioned in `text`. */
export function findMentions(text: string, people: Mentionable[]): string[] {
  const pattern = mentionPattern(people.map((p) => p.name));
  if (!pattern) return [];
  const ids = new Set<string>();
  for (const m of text.matchAll(pattern)) {
    const name = m[1]!.toLowerCase();
    const person = people.find((p) => p.name.toLowerCase() === name);
    if (person) ids.add(person.id);
  }
  return [...ids];
}
