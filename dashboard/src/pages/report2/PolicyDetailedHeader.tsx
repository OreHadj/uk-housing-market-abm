import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PolicyDetailedHeaderProps {
  title: string;
  runPickers: ReactNode;
  presentationControls: ReactNode;
  analysisWindowControl: ReactNode;
  printDisabled: boolean;
}

/** Policy-only header that shares Report2's layout without changing the sensitivity views. */
export function PolicyDetailedHeader({
  title,
  runPickers,
  presentationControls,
  analysisWindowControl,
  printDisabled
}: PolicyDetailedHeaderProps) {
  const [workspaceTitle, setWorkspaceTitle] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Keep this component importable by the server-rendered results tests.
    void import('./policy-detailed-header.css');
    const heading = document.getElementById('workspace-page-title');
    if (!heading) return;
    const titleHost = document.createElement('span');
    titleHost.className = 'policy-detailed-workspace-title';
    heading.append(titleHost);
    setWorkspaceTitle(titleHost);
    return () => titleHost.remove();
  }, []);

  return (
    <div className="policy-detailed-header">
      {workspaceTitle && createPortal(<><span aria-hidden="true"> / </span>Policy scenarios<span aria-hidden="true"> / </span>Detailed</>, workspaceTitle)}
      <div className="policy-detailed-toolbar">
        {runPickers}
        {presentationControls}
      </div>
      <header className="policy-detailed-page-heading">
        <div>
          <p className="policy-detailed-eyebrow">Results / Policy runs</p>
          <h1 id="policy-detailed-title">{title}</h1>
          <p className="policy-detailed-caption">The market, the borrowers, and the wider effects.</p>
        </div>
        <div className="policy-detailed-report-actions">
          {analysisWindowControl}
          <button
            className="policy-detailed-print"
            type="button"
            onClick={() => globalThis.window.print()}
            disabled={printDisabled}
            aria-label="Print detailed policy results"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7zM17 11h.01" />
            </svg>
            <span>Print</span>
          </button>
        </div>
      </header>
    </div>
  );
}
