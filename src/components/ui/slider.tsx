import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "../../lib/utils";

/**
 * Radix slider with overridable sub-part classes. The thinking-intensity
 * slider renders its own rail/ticks behind a transparent-track slider, so
 * Track/Range/Thumb styling must be injectable.
 */
function Slider({
  className,
  trackClassName,
  rangeClassName,
  thumbClassName,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  trackClassName?: string;
  rangeClassName?: string;
  thumbClassName?: string;
}) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex h-1.5 w-full touch-none select-none items-center data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn("relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary", trackClassName)}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn("absolute h-full bg-primary", rangeClassName)}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        className={cn(
          "block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm transition-transform hover:scale-110 focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none active:scale-95 disabled:pointer-events-none",
          thumbClassName,
        )}
      />
    </SliderPrimitive.Root>
  );
}

export { Slider };
