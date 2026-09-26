"use client";

import { useEffect } from "react";

export function NumberInputWheelGuard() {
  useEffect(() => {
    function preventWheelAdjustment(event: WheelEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement &&
        target.type === "number" &&
        document.activeElement === target
      ) {
        event.preventDefault();
      }
    }

    document.addEventListener("wheel", preventWheelAdjustment, {
      capture: true,
      passive: false,
    });

    return () => {
      document.removeEventListener("wheel", preventWheelAdjustment, true);
    };
  }, []);

  return null;
}
