/**
 * Returns true for UNC paths (\\server\share) and forward-slash equivalents
 * (//server/share). Synchronous filesystem checks can hang on SMB timeouts for
 * these paths, so callers should skip those checks for network paths.
 */
export function isLikelyNetworkPath(p: string): boolean {
  return p.startsWith("\\\\") || p.startsWith("//");
}
