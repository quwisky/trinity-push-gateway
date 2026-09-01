import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DynamicForm, FormConfig } from '@ng-forge/dynamic-forms';
import { standardSchema } from '@ng-forge/dynamic-forms/schema';
import { StatusAnnouncer } from '../../core/status/status-announcer';
import { confirmationSchema } from '../../core/validation/schemas';
import { HlmButton } from '../helm/button';
import '../form/spartan-form.types';

export type ConfirmationActionResult = Readonly<{
  succeeded: boolean;
  message: string;
}>;

export type ConfirmationRequest = Readonly<{
  title: string;
  description: string;
  confirmationLabel: string;
  pendingLabel: string;
  action: () => Promise<ConfirmationActionResult>;
}>;

@Component({
  selector: 'tpg-confirmation-dialog',
  imports: [DynamicForm, HlmButton],
  templateUrl: './confirmation-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmationDialog {
  private readonly document = inject(DOCUMENT);
  private readonly announcer = inject(StatusAnnouncer);
  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private resolver: ((result: boolean) => void) | undefined;
  private returnFocus: HTMLElement | undefined;

  protected readonly request = signal<ConfirmationRequest | undefined>(
    undefined,
  );
  protected readonly pending = signal(false);
  protected readonly status = signal('');
  protected readonly formOptions = computed(() => ({
    disabled: this.pending(),
    idPrefix: 'operator-action-confirmation',
  }));
  protected readonly form = computed(
    () =>
      ({
        fields: [
          {
            key: 'confirmed',
            type: 'checkbox',
            value: false,
            label:
              this.request()?.confirmationLabel ?? 'Confirm operator action',
          },
          { key: 'confirm', type: 'submit', label: 'Confirm action' },
        ],
        schema: standardSchema(confirmationSchema),
      }) as const satisfies FormConfig,
  );

  open(request: ConfirmationRequest): Promise<boolean> {
    if (this.dialog().nativeElement.open) {
      return Promise.resolve(false);
    }

    this.request.set(request);
    this.pending.set(false);
    this.status.set('');
    const activeElement = this.document.activeElement;
    this.returnFocus =
      activeElement instanceof HTMLElement ? activeElement : undefined;
    this.dialog().nativeElement.showModal();
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  protected cancel(event: Event): void {
    event.preventDefault();
    if (!this.pending()) {
      this.close(false);
    }
  }

  protected close(result: boolean): void {
    this.dialog().nativeElement.close();
    this.request.set(undefined);
    this.resolver?.(result);
    this.resolver = undefined;
    queueMicrotask(() => this.returnFocus?.focus());
  }

  protected async run(): Promise<void> {
    const request = this.request();
    if (!request || this.pending()) {
      return;
    }

    this.pending.set(true);
    this.status.set('');
    let result: ConfirmationActionResult;
    try {
      result = await request.action();
    } catch {
      result = {
        succeeded: false,
        message: 'The Operator Action failed before returning a safe result.',
      };
    }
    this.announcer.announce(result.message);
    if (result.succeeded) {
      this.close(true);
      return;
    }
    this.status.set(result.message);
    this.pending.set(false);
  }
}
