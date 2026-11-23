/** True if the text starts (first strong character) with a right-to-left script (Arabic, Hebrew…). */
export function isRtl(text: string): boolean {
  const m = text.match(/[A-Za-zÀ-ɏ֐-ࣿ]/);
  return !!m && /[֐-ࣿ]/.test(m[0]);
}
