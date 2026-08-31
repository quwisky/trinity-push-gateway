import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import {
  DynamicTextPipe,
  injectNgForgeField,
  NgForgeControl,
  NgForgeFieldHost,
} from '@ng-forge/dynamic-forms/integration';
import { HlmInput } from '../helm/input';
import { HlmLabel } from '../helm/label';

@Component({
  selector: 'tpg-spartan-datetime-field',
  imports: [
    AsyncPipe,
    DynamicTextPipe,
    FormField,
    HlmInput,
    HlmLabel,
    NgForgeControl,
  ],
  hostDirectives: [NgForgeFieldHost],
  host: { class: 'form-field' },
  template: `
    @let state = field.field();
    @let inputId = field.key() + '-datetime';
    @if (field.label(); as label) {
      <label hlmLabel [for]="inputId">
        {{ label | dynamicText | async }}
      </label>
    }
    <input
      hlmInput
      ngForgeControl
      type="datetime-local"
      [formField]="state"
      [id]="inputId"
      [attr.tabindex]="field.tabIndex()"
      [class.control-invalid]="state().invalid() && state().touched()"
    />
    @if (field.errorsToDisplay()[0]; as error) {
      <p class="field-error" [id]="field.errorId()" role="alert">
        {{ error.message }}
      </p>
    } @else if (props()?.hint; as hint) {
      <p class="field-hint" [id]="field.hintId()">{{ hint }}</p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpartanDateTimeFieldComponent {
  protected readonly field = injectNgForgeField<string>();
  readonly props = input<Readonly<{ hint?: string }>>();
}
