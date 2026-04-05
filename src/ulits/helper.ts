/**
 * Truncates text for Discord field/title limits, appending an ellipsis when trimmed.
 *
 * @param text - Raw string (e.g. stream title).
 * @param max - Maximum length including the ellipsis character.
 * @returns Truncated string.
 */
export function truncateForDiscord(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Collects streamer logins from env keys whose names contain `TWITCH_STREAMER_` (any suffix).
 *
 * @returns Lowercased, non-empty logins (not validated against Twitch login rules).
 */
export function collectEnvStreamers(): string[] {
  const out: string[] = [];
  for (const key of Object.keys(process.env)) {
    if (!key.includes('TWITCH_STREAMER_')) continue;
    const raw = process.env[key]?.trim().toLowerCase();
    if (raw) out.push(raw);
  }
  return out;
}
