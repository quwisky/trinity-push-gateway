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
import { SpartanTextProps } from './spartan-form.types';

@Component({
  selector: 'tpg-spartan-text-field',
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
  templateUrl: './spartan-text-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpartanTextFieldComponent {
  protected readonly field = injectNgForgeField<string>();
  readonly props = input<SpartanTextProps>();
}
