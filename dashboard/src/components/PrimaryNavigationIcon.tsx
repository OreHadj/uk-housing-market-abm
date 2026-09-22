import type { PrimaryDestination } from '../lib/workspaceNavigation';

/** Decorative icons accompany the existing text labels in the main navigation. */
export function PrimaryNavigationIcon({ destination }: { destination: PrimaryDestination }) {
  return (
    <svg
      className="main-nav-destination-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {destination === 'home' && <path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9" />}
      {destination === 'experiments' && <>
        <path d="M9 3h6M10 3v6l-5.5 9.2A1.8 1.8 0 0 0 6 21h12a1.8 1.8 0 0 0 1.5-2.8L14 9V3M8 14h8" />
        <path d="M10 17h.01M14 18h.01" />
      </>}
      {destination === 'results' && <path d="M4 3v17h17M8 16v-5m5 5V7m5 9V4" />}
      {destination === 'model-evidence' && <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>}
      {destination === 'settings' && <>
        <path d="m9.5 3-.6 2.4-1.4.8-2.4-.7-2.5 4.3 1.8 1.7v1l-1.8 1.7 2.5 4.3 2.4-.7 1.4.8.6 2.4h5l.6-2.4 1.4-.8 2.4.7 2.5-4.3-1.8-1.7v-1l1.8-1.7-2.5-4.3-2.4.7-1.4-.8-.6-2.4z" />
        <circle cx="12" cy="12" r="3" />
      </>}
    </svg>
  );
}
