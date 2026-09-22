import assert from 'node:assert/strict';
import { installDesktopDialogFocusFix } from '../src/lib/desktopDialogFocus';

type Target = NonNullable<Parameters<typeof installDesktopDialogFocusFix>[0]>;

function fakeWindow(options: { bridge: boolean; refocusFails?: boolean }) {
  const calls: string[] = [];
  const target = {
    alert: (message?: unknown) => { calls.push(`alert:${String(message)}`); },
    confirm: (message?: string) => { calls.push(`confirm:${message}`); return message === 'yes'; },
    prompt: (message?: string, defaultValue?: string) => {
      calls.push(`prompt:${message}`);
      if (message === 'fail') throw new Error('dialog failed');
      return defaultValue ?? null;
    },
    ukHousingDesktop: options.bridge ? {
      restoreKeyboardFocus: async () => {
        calls.push('refocus');
        if (options.refocusFails) throw new Error('window closed');
      }
    } : undefined
  };
  return { target: target as unknown as Target, calls };
}

{
  const { target, calls } = fakeWindow({ bridge: true });
  installDesktopDialogFocusFix(target);
  assert.equal(target.confirm('yes'), true, 'The user’s answer passes through unchanged');
  assert.equal(target.confirm('no'), false);
  assert.equal(target.prompt('key', 'abc'), 'abc');
  target.alert('done');
  assert.deepEqual(calls, ['confirm:yes', 'refocus', 'confirm:no', 'refocus', 'prompt:key', 'refocus', 'alert:done', 'refocus'],
    'Keyboard focus is restored after every native dialog closes');
  assert.throws(() => target.prompt('fail'), /dialog failed/);
  assert.equal(calls.at(-1), 'refocus', 'Focus is restored even when a dialog throws');
}

{
  const { target, calls } = fakeWindow({ bridge: true, refocusFails: true });
  installDesktopDialogFocusFix(target);
  assert.equal(target.confirm('yes'), true, 'A failed refocus never breaks the dialog result');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['confirm:yes', 'refocus']);
}

{
  const { target } = fakeWindow({ bridge: false });
  const { alert, confirm, prompt } = target;
  installDesktopDialogFocusFix(target);
  assert.equal(target.alert, alert, 'Browsers without the desktop bridge keep their native dialogs');
  assert.equal(target.confirm, confirm);
  assert.equal(target.prompt, prompt);
}

console.log('Desktop dialog focus tests passed.');
