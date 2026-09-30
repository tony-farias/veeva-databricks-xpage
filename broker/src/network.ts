export function proxyClientIp(value: string | undefined): string {
  if (!value) return "unknown";
  const bracketed = value.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketed?.[1]) return bracketed[1];
  const ipv4WithPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  return ipv4WithPort?.[1] ?? value;
}
