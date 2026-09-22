import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

export const ExperimentHeaderStartTarget = createContext<HTMLElement | null>(null);

/** Keep the wizard's submission handler and validation state with the button displayed in its header. */
export function ExperimentHeaderStartButton({
  disabled,
  isSubmitting,
  requiresOverwriteConfirmation = false,
  onStart
}: {
  disabled: boolean;
  isSubmitting: boolean;
  requiresOverwriteConfirmation?: boolean;
  onStart: () => void;
}) {
  const target = useContext(ExperimentHeaderStartTarget);
  if (!target) return null;
  const blocked = disabled || isSubmitting;
  return createPortal(
    <button
      type="button"
      className="primary-button"
      style={{
        background: '#237a36', marginTop: 0, minHeight: '2.5rem', padding: '0.55rem 0.9rem',
        fontSize: '0.95rem', fontWeight: 750, opacity: blocked ? 0.55 : 1,
        cursor: blocked ? 'not-allowed' : 'pointer'
      }}
      disabled={blocked}
      onClick={onStart}
    >
      {isSubmitting ? 'Starting…' : requiresOverwriteConfirmation ? 'Replace results and start' : 'Start'}
    </button>,
    target
  );
}
