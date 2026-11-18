/**
 * Copies text to the clipboard. Returns false when it could not (so the UI can offer the link
 * to copy by hand). `navigator.clipboard` only exists in secure contexts, so on plain http we
 * fall back to a hidden textarea and `document.execCommand('copy')`.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // permission denied or document not focused: try the fallback
    }
  }
  return execCommandCopy(text);
}

function execCommandCopy(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
