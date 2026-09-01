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
  templateUrl: './spartan-datetime-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpartanDateTimeFieldComponent {
  protected readonly field = injectNgForgeField<string>();
  readonly props = input<Readonly<{ hint?: string }>>();
}
