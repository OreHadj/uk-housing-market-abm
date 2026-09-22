import { useRef, useState } from 'react';

type DesktopActionResult = UkHousingDesktopFolderOpenResult & { path?: string };

interface DesktopActionButtonProps {
  label: string;
  pendingLabel: string;
  action: () => Promise<DesktopActionResult>;
  failureMessage: string;
  successMessage?: (result: DesktopActionResult) => string;
}

/** Keep desktop action feedback beside its trigger in Settings and Results. */
export function DesktopActionButton({
  label,
  pendingLabel,
  action,
  failureMessage,
  successMessage
}: DesktopActionButtonProps) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleClick = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      if (result.ok) {
        setMessage(successMessage?.(result) ?? '');
      } else {
        setError(result.error || failureMessage);
      }
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : failureMessage);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <div className="desktop-action">
      <button
        type="button"
        className="desktop-action-button"
        onClick={() => void handleClick()}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? pendingLabel : label}
      </button>
      {error && <p className="desktop-action-message desktop-action-error" role="alert">{error}</p>}
      <div role="status" aria-live="polite">
        {message && <p className="desktop-action-message">{message}</p>}
      </div>
    </div>
  );
}
