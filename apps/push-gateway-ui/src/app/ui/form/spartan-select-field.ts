import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { FieldOption } from '@ng-forge/dynamic-forms';
import {
  DynamicTextPipe,
  injectNgForgeField,
  NgForgeControl,
  NgForgeFieldHost,
} from '@ng-forge/dynamic-forms/integration';
import { HlmLabel } from '../helm/label';
import { HlmNativeSelect } from '../helm/native-select';

@Component({
  selector: 'tpg-spartan-select-field',
  imports: [
    AsyncPipe,
    DynamicTextPipe,
    FormField,
    HlmLabel,
    HlmNativeSelect,
    NgForgeControl,
  ],
  hostDirectives: [NgForgeFieldHost],
  host: { class: 'form-field' },
  template: `
    @let state = field.field();
    @let selectId = field.key() + '-select';
    @if (field.label(); as label) {
      <label hlmLabel [for]="selectId">
        {{ label | dynamicText | async }}
      </label>
    }
    <hlm-native-select
      [ngForgeControl]="'select'"
      [formField]="state"
      [selectId]="selectId"
      [tabIndex]="field.tabIndex()"
      [forceInvalid]="state().invalid() && state().touched()"
    >
      @for (option of options(); track option.value) {
        <option [value]="option.value" [disabled]="option.disabled ?? false">
          {{ option.label | dynamicText | async }}
        </option>
      }
    </hlm-native-select>
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
export class SpartanSelectFieldComponent {
  protected readonly field = injectNgForgeField<string>();
  readonly options = input<readonly FieldOption<string>[]>([]);
  readonly props = input<Readonly<{ hint?: string }>>();
}
