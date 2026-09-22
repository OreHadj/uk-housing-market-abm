type DialogWindow = Pick<Window, 'alert' | 'confirm' | 'prompt' | 'ukHousingDesktop'>;

/**
 * In the Windows desktop app, closing a native alert, confirm or prompt can leave the page without
 * keyboard focus, so text and number fields stop accepting typing. After each native dialog, ask
 * the desktop shell to restore focus. Browsers and other platforms are unaffected.
 */
export function installDesktopDialogFocusFix(target: DialogWindow = window): void {
  const desktop = target.ukHousingDesktop;
  if (!desktop?.restoreKeyboardFocus) return;
  const refocus = () => {
    void desktop.restoreKeyboardFocus?.().catch(() => undefined);
  };
  const alert = target.alert.bind(target);
  const confirm = target.confirm.bind(target);
  const prompt = target.prompt.bind(target);
  target.alert = (message?: unknown) => {
    try { alert(message); } finally { refocus(); }
  };
  target.confirm = (message?: string) => {
    try { return confirm(message); } finally { refocus(); }
  };
  target.prompt = (message?: string, defaultValue?: string) => {
    try { return prompt(message, defaultValue); } finally { refocus(); }
  };
}
