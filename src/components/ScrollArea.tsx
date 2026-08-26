import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject, ReactNode } from "react";

/**
 * Overlay scrollbar (shadcn/ui ScrollArea-style): native scrollbar hidden,
 * a floating thumb appears on hover, supports drag and track clicks.
 * Adds no layout space.
 */
export function ScrollArea({
  children,
  className = "",
  viewportClassName = "",
  onScroll,
  viewportRef,
}: {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  onScroll?: () => void;
  viewportRef?: RefObject<HTMLDivElement | null>;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const setViewport = (el: HTMLDivElement | null) => {
    innerRef.current = el;
    if (viewportRef) viewportRef.current = el;
  };
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startY: number; startScroll: number } | null>(null);

  const update = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 1) {
      setThumb(null);
      return;
    }
    const height = Math.max(28, (clientHeight / scrollHeight) * clientHeight);
    const top = (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height);
    setThumb({ top, height });
  }, []);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return undefined;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [update]);

  const onThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const el = innerRef.current;
    if (!el) return;
    dragState.current = { startY: event.clientY, startScroll: el.scrollTop };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onThumbPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = innerRef.current;
    const drag = dragState.current;
    if (!el || !drag) return;
    const dy = event.clientY - drag.startY;
    const thumbHeight = thumb?.height ?? 28;
    const ratio = (el.scrollHeight - el.clientHeight) / Math.max(1, el.clientHeight - thumbHeight);
    el.scrollTop = drag.startScroll + dy * ratio;
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragState.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className={`group/scroll relative ${className}`}>
      <div
        ref={setViewport}
        onScroll={onScroll}
        className={`scroll-area-viewport h-full overflow-y-auto ${viewportClassName}`}
      >
        {children}
      </div>
      {/* Overlay track: invisible until the group is hovered */}
      <div
        className={`pointer-events-none absolute inset-y-0 right-0 z-20 w-2 transition-opacity duration-150 ${
          dragging ? "opacity-100" : "opacity-0 group-hover/scroll:opacity-100"
        }`}
      >
        {thumb && (
          <div
            role="scrollbar"
            aria-orientation="vertical"
            onPointerDown={onThumbPointerDown}
            onPointerMove={onThumbPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={`pointer-events-auto absolute right-0.5 w-1.5 rounded-full bg-zinc-400/70 transition-colors hover:bg-zinc-500/80 dark:bg-zinc-500/70 dark:hover:bg-zinc-400/80 ${
              dragging ? "w-2 bg-zinc-500/80" : ""
            }`}
            style={{ top: thumb.top, height: thumb.height }}
          />
        )}
      </div>
    </div>
  );
}
