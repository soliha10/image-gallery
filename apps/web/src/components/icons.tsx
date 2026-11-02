import type { ReactNode } from 'react'

function Icon({ children, filled }: { children: ReactNode; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export const HeartIcon = ({ filled }: { filled?: boolean }) => (
  <Icon filled={filled}>
    <path d="M12 20s-7.5-4.6-9.2-9.1C1.7 7.8 3.7 4.8 7 4.8c2 0 3.8 1.1 5 3 1.2-1.9 3-3 5-3 3.3 0 5.3 3 4.2 6.1C19.5 15.4 12 20 12 20Z" />
  </Icon>
)
export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Icon>
)
export const RoomIcon = () => (
  <Icon>
    <path d="M4 20V10a8 8 0 0 1 16 0v10M4 20h16M9 20v-7h6v7" />
  </Icon>
)
export const GridIcon = () => (
  <Icon>
    <rect x="4" y="4" width="7" height="9" rx="1.5" />
    <rect x="13" y="4" width="7" height="5" rx="1.5" />
    <rect x="13" y="11" width="7" height="9" rx="1.5" />
    <rect x="4" y="15" width="7" height="5" rx="1.5" />
  </Icon>
)
export const GearIcon = () => (
  <Icon>
    <path d="M5 7h9M18 7h1M5 17h1M10 17h9" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Icon>
)
export const CloseIcon = () => (
  <Icon>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
)
export const ShareIcon = () => (
  <Icon>
    <path d="M12 15V4m0 0L8 8m4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
  </Icon>
)
export const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" />
  </Icon>
)
