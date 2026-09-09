/**
 * Copying to the clipboard, and saying whether it worked.
 *
 * `navigator.clipboard` is unavailable on insecure origins and refused when
 * the call is not inside a user gesture, so every path here can fail and the
 * caller is told rather than left to assume.
 *
 * For text there is a legacy fallback worth keeping. `execCommand("copy")`
 * still works in every browser this targets and covers a page served over
 * plain HTTP — which is exactly how someone running `eperx serve` on a
 * workshop machine will reach it, and where `navigator.clipboard` simply does
 * not exist.
 *
 * Images have no fallback. `ClipboardItem` is the only way to put a PNG on the
 * clipboard, and Safari additionally requires the *promise* form: the blob has
 * to be handed over as a pending promise created inside the gesture, not
 * awaited first. Awaiting before calling `write` is what makes this fail in
 * Safari while passing in Chrome.
 */

/** Put text on the clipboard. `false` when the browser refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyTextLegacy(text);
  }
}

function copyTextLegacy(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    // Off-screen but not `display: none`: a hidden element cannot be selected,
    // and `readonly` stops the keyboard appearing on iOS.
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Put an image on the clipboard.
 *
 * `blob` is a factory rather than a blob so the promise is created inside the
 * gesture; see the note above. eperx has an advantage here over a canvas-based
 * copy: the drawing is already a PNG blob, read straight out of the shard, so
 * nothing has to be rasterised and the bytes on the clipboard are the vendor's
 * own.
 */
export async function copyImage(blob: () => Promise<Blob>): Promise<boolean> {
  try {
    if (!("ClipboardItem" in globalThis)) return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob() })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The blob behind an object URL.
 *
 * `browse.imageUrl` is a `blob:` URL minted from the PNG the shard gave us, so
 * fetching it costs nothing — it never touches the network — and hands back
 * the original bytes rather than a re-encoding.
 */
export function blobFromUrl(url: string): () => Promise<Blob> {
  return async () => {
    const response = await fetch(url);
    return response.blob();
  };
}
