import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ConfirmationActionResult,
  ConfirmationDialog,
  ConfirmationRequest,
} from './confirmation-dialog';

type ConfirmationHarness = {
  cancel: (event: Event) => void;
  close: (result: boolean) => void;
  pending: WritableSignal<boolean>;
  run: () => Promise<void>;
  status: WritableSignal<string>;
};

const request = (
  action: () => Promise<ConfirmationActionResult>,
): ConfirmationRequest => ({
  title: 'Create backup',
  description: 'Create one verified backup.',
  confirmationLabel: 'I understand this starts a backup.',
  pendingLabel: 'Creating backup…',
  action,
});

describe('ConfirmationDialog', () => {
  it('opens a native alert dialog, handles Escape cancellation, and restores focus', async () => {
    const fixture = TestBed.createComponent(ConfirmationDialog);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const dialog = host.querySelector('dialog');
    expect(dialog).toBeInstanceOf(HTMLDialogElement);
    if (!(dialog instanceof HTMLDialogElement)) {
      throw new Error('The confirmation dialog was not rendered.');
    }
    const showModal = vi.fn();
    const close = vi.fn();
    dialog.showModal = showModal;
    dialog.close = close;
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    const result = fixture.componentInstance.open(
      request(() => Promise.resolve({ succeeded: true, message: 'Done.' })),
    );
    const event = new Event('cancel', { cancelable: true });
    const component =
      fixture.componentInstance as unknown as ConfirmationHarness;
    component.cancel(event);

    await expect(result).resolves.toBe(false);
    await Promise.resolve();
    expect(showModal).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('keeps failures visible and closes only after a successful action', async () => {
    const fixture = TestBed.createComponent(ConfirmationDialog);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const dialog = host.querySelector('dialog');
    expect(dialog).toBeInstanceOf(HTMLDialogElement);
    if (!(dialog instanceof HTMLDialogElement)) {
      throw new Error('The confirmation dialog was not rendered.');
    }
    const showModal = vi.fn();
    const close = vi.fn();
    dialog.showModal = showModal;
    dialog.close = close;
    const component =
      fixture.componentInstance as unknown as ConfirmationHarness;

    const failedResult = fixture.componentInstance.open(
      request(() =>
        Promise.resolve({ succeeded: false, message: 'Backup failed safely.' }),
      ),
    );
    await component.run();
    expect(component.status()).toBe('Backup failed safely.');
    expect(component.pending()).toBe(false);
    expect(close).not.toHaveBeenCalled();
    component.close(false);
    await expect(failedResult).resolves.toBe(false);

    const rejectedResult = fixture.componentInstance.open(
      request(() => Promise.reject(new Error('raw upstream detail'))),
    );
    await component.run();
    expect(component.status()).toBe(
      'The Operator Action failed before returning a safe result.',
    );
    component.close(false);
    await expect(rejectedResult).resolves.toBe(false);

    const succeededResult = fixture.componentInstance.open(
      request(() => Promise.resolve({ succeeded: true, message: 'Done.' })),
    );
    await component.run();
    await expect(succeededResult).resolves.toBe(true);
    expect(showModal).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(3);
  });
});
