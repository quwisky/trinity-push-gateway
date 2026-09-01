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
  templateUrl: './spartan-select-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpartanSelectFieldComponent {
  protected readonly field = injectNgForgeField<string>();
  readonly options = input<readonly FieldOption<string>[]>([]);
  readonly props = input<Readonly<{ hint?: string }>>();
}
