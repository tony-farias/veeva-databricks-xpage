// Databricks accepts any string as the OAuth identity claim, including an empty
// one, and SQL compares it byte for byte. Canonicalize here so entitlement rows
// can be keyed by a single lowercase spelling, and refuse anything ambiguous.
export function canonicalIdentityClaim(value: string): string | null {
  const claim = value.trim().toLowerCase();
  return /^[\x21-\x7e]{1,256}$/.test(claim) ? claim : null;
}
