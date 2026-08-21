import { useId, useState, type ReactNode } from 'react';

interface CollapsibleSectionProps {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  summary?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function CollapsibleSection({
  id,
  title,
  description,
  defaultOpen = false,
  open,
  onOpenChange,
  summary,
  className,
  bodyClassName,
  children
}: CollapsibleSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const contentId = useId();

  const rootClassName = ['collapsible-section', isOpen ? 'is-open' : 'is-collapsed', className]
    .filter(Boolean)
    .join(' ');
  const contentClassName = ['collapsible-section-body', bodyClassName].filter(Boolean).join(' ');

  return (
    <section id={id} className={rootClassName}>
      <button
        type="button"
        className="collapsible-section-toggle"
        onClick={() => {
          const nextOpen = !isOpen;
          if (open === undefined) setInternalOpen(nextOpen);
          onOpenChange?.(nextOpen);
        }}
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <span className="collapsible-section-heading">
          <span className="collapsible-section-indicator" aria-hidden="true">
            {isOpen ? '▾' : '▸'}
          </span>
          {description ? (
            <span className="collapsible-section-heading-copy">
              <span className="collapsible-section-title">{title}</span>
              <span className="collapsible-section-description">{description}</span>
            </span>
          ) : (
            <span className="collapsible-section-title">{title}</span>
          )}
        </span>
        {summary ? <span className="collapsible-section-summary">{summary}</span> : null}
      </button>

      <div id={contentId} className={contentClassName} hidden={!isOpen}>
        {children}
      </div>
    </section>
  );
}
