import type { ReactNode, SVGProps } from 'react';

/** Minimal 16px stroke icons, drawn in the current text colour. */
function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export const CheckIcon = () => (
  <Icon>
    <path d="M3 8.5l3.2 3L13 4.5" />
  </Icon>
);

export const ClockIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 5v3.25l2 1.25" />
  </Icon>
);

export const ArchiveIcon = () => (
  <Icon>
    <path d="M2.5 3.5h11v2.5h-11zM3.5 6v6.5h9V6M6.5 8.5h3" />
  </Icon>
);

export const ReturnIcon = () => (
  <Icon>
    <path d="M6 4L3 7l3 3M3 7h6.5a3.5 3.5 0 010 7H8" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.2 10.2L13.5 13.5" />
  </Icon>
);

export const LinkIcon = () => (
  <Icon>
    <path d="M7 9a2.75 2.75 0 003.9 0l2-2a2.75 2.75 0 00-3.9-3.9l-.6.6M9 7a2.75 2.75 0 00-3.9 0l-2 2a2.75 2.75 0 003.9 3.9l.6-.6" />
  </Icon>
);

export const FolderIcon = () => (
  <Icon width="13" height="13">
    <path d="M2 4.5V12h12V5.5H8L6.5 4H2z" />
  </Icon>
);

export const UploadIcon = () => (
  <Icon>
    <path d="M8 10.5V3M5 6l3-3 3 3M3 10.5V13h10v-2.5" />
  </Icon>
);
