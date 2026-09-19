import type { SVGProps } from "react";

/** A friendly but production-ready poultry mark for flock and livability metrics. */
export function ChickenIcon({ className, size = 20, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true" {...props}>
    <circle cx="24" cy="24" r="23" fill="#dff2a9"/>
    <path d="M11.8 31.8c0-8.8 5.1-15.8 12.3-15.8 8.2 0 12.3 7.2 12.3 15.8 0 3.5-1.8 6.4-5 6.4H16.8c-3.1 0-5-2.9-5-6.4Z" fill="#fffdf5"/>
    <path d="M18.2 18.3c-1.3-2.2-1.1-4.6.7-6.5.3 2.2 1.4 3.7 3.3 4.8M23.6 16.6c-.1-2.4 1.1-4.6 3.2-5.9.1 2.5.9 4.2 2.6 5.6M28.5 18.4c1.1-1.8 3.1-2.8 5.3-2.6-.8 2.1-.6 3.9.6 5.8" fill="none" stroke="#f1ad22" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M16.5 26.9c1.7-5 5-7.4 8.7-7.4 4.9 0 8.2 4.1 8.2 9.9 0 2.9-1.4 5.3-3.5 6.8h-10c-2.2-1.5-3.4-4.4-3.4-7.4 0-.6 0-1.3.1-1.9Z" fill="#f7c74d"/>
    <path d="M29.3 22.4c1.8.9 3.1 2.8 3.4 5.1-2.3-.2-4.1-1.2-5.4-3.1" fill="#f25d43"/>
    <path d="M20.3 27.4c.9-1.3 2.5-2.1 4.3-2.1 2.8 0 5 2.1 5 4.8 0 2.6-2.2 4.8-5 4.8-2.6 0-4.7-1.8-4.9-4.3" fill="#fffdf5"/>
    <circle cx="26.9" cy="25.3" r="1.1" fill="#24322d"/>
    <path d="m30.6 27.9 4.3 1.4-4.3 1.5Z" fill="#f1ad22"/>
    <path d="M17.7 37.3v2.9M27.7 37.3v2.9" stroke="#d88a19" strokeWidth="2" strokeLinecap="round"/>
  </svg>;
}

export function ChickenBadge({ className, size = 48 }: { className?: string; size?: number }) {
  return <span className={className} aria-label="Poultry"><ChickenIcon size={size}/></span>;
}
