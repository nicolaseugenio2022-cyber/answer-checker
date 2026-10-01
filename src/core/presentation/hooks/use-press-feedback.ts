import { useState } from 'react';

/**
 * Pressed state held in React, for press feedback that must end the moment the
 * finger lifts. NativeWind's `active:` classes can stay applied on Android when
 * a press navigates away, leaving a control that looks pressed or selected.
 * Spread `pressHandlers` on the Pressable and style from `isPressed`.
 */
export function usePressFeedback() {
  const [isPressed, setIsPressed] = useState(false);

  return {
    isPressed,
    pressHandlers: {
      onPressIn: () => setIsPressed(true),
      onPressOut: () => setIsPressed(false),
    },
  };
}
