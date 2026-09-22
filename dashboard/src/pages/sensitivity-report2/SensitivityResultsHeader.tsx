import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface SensitivityResultsHeaderProps {
  title: string;
  presentation: 'report' | 'detailed';
  runPicker: ReactNode;
  presentationControls: ReactNode;
}

/** Shared Results framing; existing sensitivity controls and outcomes remain owned by their view. */
export function SensitivityResultsHeader({
  title,
  presentation,
  runPicker,
  presentationControls
}: SensitivityResultsHeaderProps) {
  const [workspaceTitle, setWorkspaceTitle] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Effects do not run in the Node rendering checks, which cannot import a stylesheet.
    void import('./sensitivity-results-header.css');
    const heading = document.getElementById('workspace-page-title');
    if (!heading) return;
    const titleHost = document.createElement('span');
    titleHost.className = 'sensitivity-results-workspace-title';
    heading.append(titleHost);
    setWorkspaceTitle(titleHost);
    return () => titleHost.remove();
  }, []);

  return (
    <div className="sensitivity-results-header">
      {workspaceTitle && createPortal(
        <><span aria-hidden="true"> / </span>Sensitivity analysis<span aria-hidden="true"> / </span>{presentation === 'report' ? 'Report' : 'Detailed'}</>,
        workspaceTitle
      )}
      <div className="sensitivity-results-toolbar">
        {runPicker}
        {presentationControls}
      </div>
      <header className="sensitivity-results-page-heading">
        <div>
          <p className="sensitivity-results-eyebrow">Results / Sensitivity analysis</p>
          <h1 id="sensitivity-results-title">{title}</h1>
          <p className="sensitivity-results-caption">Tested settings, outcome responses, and areas to investigate.</p>
        </div>
      </header>
    </div>
  );
}
