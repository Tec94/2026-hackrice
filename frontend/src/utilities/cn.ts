/** Minimal class-name joiner; avoids a dependency for simple conditional classes. */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
