export function sameUserName(...values: string[]): boolean {
  if (values.length < 2) return true;
  const expected = canonicalUserName(values[0] ?? "");
  return Boolean(expected) && values.every((value) => canonicalUserName(value) === expected);
}

function canonicalUserName(value: string): string {
  return value.trim().toLowerCase();
}
