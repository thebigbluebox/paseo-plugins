import { useCallback, useState, type RefObject } from "react";
import { Dimensions, Platform, type View } from "react-native";

/** Room for the iPhone home indicator, which plugins have no safe-area inset for. */
const HOME_INDICATOR = 24;

/**
 * Extra bottom padding on iOS when the screen reaches the bottom edge of the display, so the
 * buttons clear the home indicator.
 *
 * The keyboard is not handled here: the screen's scroll view handles it natively on iOS
 * (`automaticallyAdjustKeyboardInsets`). Following it from JavaScript lagged a step behind.
 */
export function useBottomInset(ref: RefObject<View | null>): { bottom: number; onLayout(): void } {
  const [atEdge, setAtEdge] = useState(false);
  const onLayout = useCallback(() => {
    if (Platform.OS !== "ios") return;
    ref.current?.measureInWindow((_x, y, _width, height) => {
      setAtEdge(Dimensions.get("window").height - (y + height) < 4);
    });
  }, [ref]);
  return { bottom: atEdge ? HOME_INDICATOR : 0, onLayout };
}
