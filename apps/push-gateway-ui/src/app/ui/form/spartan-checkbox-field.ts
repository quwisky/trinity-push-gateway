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
  templateUrl: './spartan-checkbox-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpartanCheckboxFieldComponent {
  protected readonly field = injectNgForgeField<boolean>();
  readonly props = input<Readonly<{ hint?: string }>>();
}
