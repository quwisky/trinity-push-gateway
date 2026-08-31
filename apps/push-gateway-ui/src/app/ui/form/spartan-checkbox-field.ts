import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import {
  DynamicTextPipe,
  injectNgForgeField,
  NgForgeControl,
  NgForgeFieldHost,
} from '@ng-forge/dynamic-forms/integration';
import { HlmCheckbox } from '../helm/checkbox';
import { HlmLabel } from '../helm/label';

@Component({
  selector: 'tpg-spartan-checkbox-field',
  imports: [
    AsyncPipe,
    DynamicTextPipe,
    FormField,
    HlmCheckbox,
    HlmLabel,
    NgForgeControl,
  ],
  hostDirectives: [NgForgeFieldHost],
  host: { class: 'form-field checkbox-field' },
  template: `
    @let state = field.field();
    @let checkboxId = field.key() + '-checkbox';
    <div class="checkbox-row">
      <hlm-checkbox
        [ngForgeControl]="'button[role=checkbox]'"
        [formField]="state"
        [inputId]="checkboxId"
        [tabIndex]="field.tabIndex()"
        [forceInvalid]="state().invalid() && state().touched()"
      />
      <label hlmLabel [for]="checkboxId">
        {{ field.label() | dynamicText | async }}
      </label>
    </div>
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
export class SpartanCheckboxFieldComponent {
  protected readonly field = injectNgForgeField<boolean>();
  readonly props = input<Readonly<{ hint?: string }>>();
}
