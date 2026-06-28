export function isHelpTooltipOpen({
  hovered,
  pinned,
}: {
  hovered: boolean;
  pinned: boolean;
}) {
  return hovered || pinned;
}
