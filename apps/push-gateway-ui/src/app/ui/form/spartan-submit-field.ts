import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormSubmitEvent } from '@ng-forge/dynamic-forms';
import {
  DynamicTextPipe,
  injectNgForgeAction,
  NgForgeActionHost,
} from '@ng-forge/dynamic-forms/integration';
import { HlmButton } from '../helm/button';

@Component({
  selector: 'tpg-spartan-submit-field',
  imports: [AsyncPipe, DynamicTextPipe, HlmButton],
  hostDirectives: [NgForgeActionHost],
  host: { class: 'form-actions' },
  template: `
    <button
      hlmBtn
      type="submit"
      [disabled]="action.disabled()"
      [tabIndex]="action.tabIndex()"
    >
      {{ action.label() | dynamicText | async }}
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpartanSubmitFieldComponent {
  protected readonly action = injectNgForgeAction<FormSubmitEvent>();
}
