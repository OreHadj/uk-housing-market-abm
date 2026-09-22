import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Short report help, available by mouse, keyboard or touch without moving the card. */
export function ReportInfo({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ left: 0, bottom: 0, width: 296 });
  const [positionReady, setPositionReady] = useState(false);

  function cancelClose() {
    clearTimeout(closeTimer.current);
  }

  function show() {
    cancelClose();
    if (!open) setPositionReady(false);
    setOpen(true);
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (document.activeElement !== trigger.current) setOpen(false);
    }, 150);
  }

  useEffect(() => {
    // Keep the component usable by the existing server-side rendering checks.
    void import('./report-info.css');
    return () => clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const place = (makeRoom = false) => {
      let rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(296, window.innerWidth - 24);
      const height = Math.min((tooltip.current?.scrollHeight ?? 0) + 2, window.innerHeight - 24);
      // Keep help above its icon. If the user has scrolled the icon near the screen edge,
      // bring just enough of the preceding page back into view to show the explanation.
      if (makeRoom && rect.top < height + 20 && window.scrollY > 0) {
        window.scrollBy({ top: rect.top - height - 20, behavior: 'instant' });
        rect = trigger.current?.getBoundingClientRect() ?? rect;
      }
      setPosition({
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        bottom: window.innerHeight - rect.top + 8,
        width,
        maxHeight: Math.max(30, rect.top - 20)
      });
      setPositionReady(true);
    };
    const reposition = () => place();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !tooltip.current?.contains(event.target)) setOpen(false);
    };
    place(true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);

  return <span className="report-info">
    <button ref={trigger} className="report-info-trigger" type="button" aria-label={`About ${label}`} aria-describedby={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={scheduleClose} onFocus={show} onBlur={scheduleClose} onClick={show}>
      <span aria-hidden="true">i</span>
    </button>
    {open && createPortal(<span ref={tooltip} id={id} role="tooltip" className="report-info-tooltip" style={{ ...position, visibility: positionReady ? 'visible' : 'hidden' }}
      onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>{children}</span>, document.body)}
  </span>;
}
