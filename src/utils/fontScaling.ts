import { Text, TextInput } from "react-native";

/**
 * Global cap on Dynamic Type / font scaling.
 *
 * iOS "Larger Text" (and Android font size) scales every <Text>/<TextInput> by
 * default. Left unbounded, extreme accessibility sizes blow past fixed heights
 * and break layouts. This caps the multiplier so text still enlarges for
 * low-vision users — just not far enough to detonate the UI.
 *
 * 1.3 covers the normal "large text" range and clamps the extreme accessibility
 * sizes. Individual <Text maxFontSizeMultiplier={...}> props still win, so a
 * specific label can opt into more (or less) scaling.
 *
 * Implemented by wrapping the forwardRef render (rather than defaultProps,
 * which React 19 no longer honors on function/forwardRef components).
 */
const MAX_FONT_SCALE = 1.3;

function capFontScaling(target: any): void {
  if (!target || target.__fontScaleCapped) return;

  // forwardRef component exposes a render(props, ref) function.
  if (typeof target.render === "function") {
    const original = target.render;
    target.render = function (props: any, ref: any) {
      return original.call(
        this,
        { maxFontSizeMultiplier: MAX_FONT_SCALE, ...props },
        ref
      );
    };
    target.__fontScaleCapped = true;
    return;
  }

  // memo(forwardRef(...)) wraps the real component under `.type`.
  if (target.type) {
    capFontScaling(target.type);
    target.__fontScaleCapped = true;
    return;
  }

  // Last-resort fallback for older React that still reads defaultProps.
  target.defaultProps = {
    ...(target.defaultProps || {}),
    maxFontSizeMultiplier: MAX_FONT_SCALE,
  };
  target.__fontScaleCapped = true;
}

export function applyGlobalFontScaleCap(): void {
  capFontScaling(Text as any);
  capFontScaling(TextInput as any);
}
