/**
 * Keeps the whole reply footer, Send included, above the iOS keyboard.
 *
 * The screen's scroll view (`automaticallyAdjustKeyboardInsets`) makes room for the keyboard
 * natively, but iOS only scrolls far enough to show the text cursor, leaving the bottom of the
 * reply box and Send under the keyboard. When the keyboard shows for the reply box, this scrolls
 * the rest of the way. Works in content coordinates, so it does not matter how far iOS has
 * already scrolled.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { Keyboard, Platform, type KeyboardEvent, type ScrollView, type View } from "react-native";

/** Gap between the reply footer and the keyboard. */
const GAP = 8;

/**
 * The card's reply footer, and whether its text box is being typed in; set by the card. Set on
 * touch, not only on focus: iOS announces the keyboard before the box reports focus.
 */
export const replyTarget: { footer: View | null; focused: boolean } = { footer: null, focused: false };

export function useKeepReplyVisible(
  scroll: RefObject<ScrollView | null>,
  content: RefObject<View | null>,
  /** Where `content` starts inside the scroll view: the scroll content's top padding. */
  contentTop: number,
  screen: RefObject<View | null>,
): { onLayout(): void } {
  /** The scroll view's top edge in window coordinates. */
  const screenTop = useRef<number | null>(null);

  const onLayout = useCallback(() => {
    if (Platform.OS !== "ios") return;
    screen.current?.measureInWindow((_x, y) => {
      screenTop.current = y;
    });
  }, [screen]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const adjust = (event: KeyboardEvent) => {
      const { footer, focused } = replyTarget;
      const top = screenTop.current;
      if (!focused || !footer || !content.current || top === null) return;
      // iOS sometimes reports a keyboard with no height (switching input modes, dictation);
      // there is nothing to clear then, and using it would scroll the screen away.
      if (event.endCoordinates.height <= 0 || event.endCoordinates.screenY <= top) return;
      footer.measureLayout(
        content.current,
        (_left, y, _width, height) => {
          const footerBottom = contentTop + y + height + GAP;
          const visible = event.endCoordinates.screenY - top;
          const target = footerBottom - visible;
          // Animated alongside the keyboard; at "didShow" the screen is normally already there.
          if (target > 0) scroll.current?.scrollTo({ y: target, animated: true });
        },
        () => {},
      );
    };
    const subscriptions = [
      Keyboard.addListener("keyboardWillShow", adjust),
      // A second chance once the keyboard is up, in case focus was reported after it started.
      Keyboard.addListener("keyboardDidShow", adjust),
      // A touch on the box that never became focus must not linger.
      Keyboard.addListener("keyboardDidHide", () => {
        replyTarget.focused = false;
      }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [scroll, content, contentTop]);

  return { onLayout };
}
