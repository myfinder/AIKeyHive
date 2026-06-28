import { isHelpTooltipOpen } from "@/lib/ui/help-tooltip-state";

describe("isHelpTooltipOpen", () => {
  it("opens only from hover or an explicit pinned click state", () => {
    expect(isHelpTooltipOpen({ hovered: false, pinned: false })).toBe(false);
    expect(isHelpTooltipOpen({ hovered: true, pinned: false })).toBe(true);
    expect(isHelpTooltipOpen({ hovered: false, pinned: true })).toBe(true);
  });
});
