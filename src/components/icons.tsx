interface IconProps {
  className?: string;
  size?: number;
}

function svgProps(size: number | undefined) {
  return {
    width: size ?? 16,
    height: size ?? 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  } as const;
}

export function IconPlus({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconSearch({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

export function IconSun({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
    </svg>
  );
}

export function IconMoon({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

export function IconMonitor({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </svg>
  );
}

export function IconPanelLeft({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 4v16" />
    </svg>
  );
}

export function IconChevronDown({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconChevronRight({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function IconSend({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M4.5 12h15m0 0-6-6m6 6-6 6" />
    </svg>
  );
}

export function IconSquare({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconPencil({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

export function IconTrash({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M3 6h18m-5 0V4a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v2m3 5v6m4-6v6M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14" />
    </svg>
  );
}

export function IconLayers({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="m12 2 9 5-9 5-9-5 9-5Zm9 10-9 5-9-5m18 5-9 5-9-5" />
    </svg>
  );
}

export function IconBrain({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M12 4a3.5 3.5 0 0 0-3.5 3.5c-2 .3-3.5 1.8-3.5 3.8 0 1.2.5 2.2 1.4 2.9-.3.6-.4 1.2-.4 1.8A3.9 3.9 0 0 0 9.9 20c.9 0 1.6-.3 2.1-.8V4Zm0 0a3.5 3.5 0 0 1 3.5 3.5c2 .3 3.5 1.8 3.5 3.8 0 1.2-.5 2.2-1.4 2.9.3.6.4 1.2.4 1.8A3.9 3.9 0 0 1 14.1 20c-.9 0-1.6-.3-2.1-.8" />
    </svg>
  );
}

export function IconBot({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 8V4m-4 9v2m8-2v2M2 13v3m20-3v3" />
    </svg>
  );
}

export function IconUser({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

export function IconX({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function IconCopy({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function IconCheck({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="m4 12.5 5 5L20 6.5" />
    </svg>
  );
}

export function IconExternalLink({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M15 3h6v6m0-6L10 14M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function IconAtSign({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

export function IconZap({ className, size }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
    </svg>
  );
}
