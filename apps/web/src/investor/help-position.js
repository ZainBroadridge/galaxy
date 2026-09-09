/** Clamp the BA explainer to the viewport without obscuring its trigger. */
export function helpPlacement(anchor, popup, viewport) {
  const inset = 16;
  const width = Math.min(600, Math.max(0, viewport.width - inset * 2));
  const height = Math.min(popup.height, Math.max(0, viewport.height - inset * 2));
  const left = Math.max(inset, Math.min(anchor.left + anchor.width / 2 - width / 2, viewport.width - width - inset));
  const above = anchor.top - height - 14 >= inset;
  const top = above ? anchor.top - height - 14 : Math.min(anchor.bottom + 14, viewport.height - height - inset);
  return { left, top: Math.max(inset, top), width, maxHeight: Math.max(0, viewport.height - inset * 2),
    arrowLeft: Math.max(12, Math.min(width - 34, anchor.left + anchor.width / 2 - left - 11)), side: above ? 'top' : 'bottom' };
}
