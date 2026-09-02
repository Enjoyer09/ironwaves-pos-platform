import { useState, useEffect, useCallback, useRef } from 'react';

type UseResizableSplitPaneOptions = {
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
};

export function useResizableSplitPane({
  storageKey,
  defaultWidth = 440,
  minWidth = 320,
  maxWidth = 620,
}: UseResizableSplitPaneOptions) {
  const [cartWidth, setCartWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= minWidth && val <= maxWidth) {
          return val;
        }
      }
    } catch {}
    return defaultWidth;
  });

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);

  const updateWidth = useCallback((newWidth: number) => {
    const clamped = Math.max(minWidth, Math.min(maxWidth, Math.round(newWidth)));
    setCartWidth(clamped);
    try {
      localStorage.setItem(storageKey, String(clamped));
    } catch {}
  }, [storageKey, minWidth, maxWidth]);

  const resetToDefault = useCallback(() => {
    updateWidth(defaultWidth);
  }, [updateWidth, defaultWidth]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only handle primary pointer (left click or touch)
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    
    e.preventDefault();
    isDraggingRef.current = true;
    setIsDragging(true);

    const container = containerRef.current || (e.currentTarget.parentElement as HTMLDivElement | null);
    
    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!isDraggingRef.current) return;
      moveEvent.preventDefault();

      let calculatedWidth = cartWidth;
      if (container) {
        const rect = container.getBoundingClientRect();
        // Width of right panel is distance from pointer to container right edge
        calculatedWidth = rect.right - moveEvent.clientX;
      } else {
        calculatedWidth = window.innerWidth - moveEvent.clientX;
      }

      const clamped = Math.max(minWidth, Math.min(maxWidth, Math.round(calculatedWidth)));
      setCartWidth(clamped);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      let calculatedWidth = cartWidth;
      if (container) {
        const rect = container.getBoundingClientRect();
        calculatedWidth = rect.right - upEvent.clientX;
      } else {
        calculatedWidth = window.innerWidth - upEvent.clientX;
      }

      const clamped = Math.max(minWidth, Math.min(maxWidth, Math.round(calculatedWidth)));
      try {
        localStorage.setItem(storageKey, String(clamped));
      } catch {}
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }, [cartWidth, minWidth, maxWidth, storageKey]);

  return {
    cartWidth,
    isDragging,
    containerRef,
    onPointerDown,
    resetToDefault,
    setCartWidth: updateWidth,
  };
}
