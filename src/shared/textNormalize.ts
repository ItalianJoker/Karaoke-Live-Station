/**
 * Accent/diacritic folding for user-facing search filters.
 *
 * Both the query and the searchable text are normalized the same way so that
 * "moriro da re" matches "morirò da re", while accented queries still match
 * (additive: folding both sides preserves accented → accented hits).
 */

/**
 * NFD-decompose, strip combining marks, then lowercase.
 * Empty/nullish input yields an empty string.
 */
export function normalizeForSearch(text: string | null | undefined): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/**
 * Case- and accent-insensitive substring match.
 * An empty/whitespace-only needle matches everything (caller usually short-circuits).
 */
export function textMatchesSearch(
  haystack: string | null | undefined,
  needle: string | null | undefined
): boolean {
  const q = normalizeForSearch(needle).trim();
  if (!q) return true;
  return normalizeForSearch(haystack).includes(q);
}
