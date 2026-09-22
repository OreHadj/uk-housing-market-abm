import { useLayoutEffect, useRef, useState } from 'react';

/** Scroll after the selected run has rendered, including when it was already selected. */
export function useResultsTopNavigation() {
  const [scrollRequest, setScrollRequest] = useState(0);
  const selectionRef = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => {
    if (scrollRequest === 0) return;
    selectionRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [scrollRequest]);
  return { selectionRef, requestScrollToTop: () => setScrollRequest((current) => current + 1) };
}
