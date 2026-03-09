export type KeyLikeEvent = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
};

export function isSendShortcut(e: KeyLikeEvent): boolean {
  if (e.key !== "Enter") return false;
  if (e.shiftKey) return false;
  if (e.altKey) return false;

  const composing = Boolean(e.isComposing || e.nativeEvent?.isComposing);
  if (composing) return false;

  // Cmd+Enter (macOS) or Ctrl+Enter (Windows/Linux)
  return Boolean(e.metaKey || e.ctrlKey);
}
