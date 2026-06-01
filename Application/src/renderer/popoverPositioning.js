export const DEFAULT_POPOVER_MARGIN = 16;

export function clampFloatingPosition({
  position = {},
  size = {},
  viewport = {},
  margin = DEFAULT_POPOVER_MARGIN,
}) {
  const viewportWidth = Number(viewport.width) || 0;
  const viewportHeight = Number(viewport.height) || 0;
  const width = Math.min(Number(size.width) || 0, Math.max(viewportWidth - margin * 2, 0));
  const height = Math.min(Number(size.height) || 0, Math.max(viewportHeight - margin * 2, 0));
  const maxLeft = Math.max(viewportWidth - width - margin, margin);
  const maxTop = Math.max(viewportHeight - height - margin, margin);

  return {
    left: Math.max(margin, Math.min(Number(position.left) || margin, maxLeft)),
    top: Math.max(margin, Math.min(Number(position.top) || margin, maxTop)),
  };
}
