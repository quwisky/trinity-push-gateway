import type { EnvironmentProviders } from '@angular/core';
import { provideDynamicForm, withLoggerConfig } from '@ng-forge/dynamic-forms';
import {
  checkboxFieldMapper,
  datepickerFieldMapper,
  FieldTypeDefinition,
  optionsFieldMapper,
  submitButtonFieldMapper,
  valueFieldMapper,
} from '@ng-forge/dynamic-forms/integration';
import './spartan-form.types';

const valueField = {
  renderReadyWhen: ['field'],
} as const;

export const SPARTAN_FIELD_TYPES: readonly FieldTypeDefinition[] = [
  {
    name: 'input',
    loadComponent: () =>
      import('./spartan-text-field').then(
        ({ SpartanTextFieldComponent }) => SpartanTextFieldComponent,
      ),
    mapper: valueFieldMapper,
    propsToMeta: ['type'],
    scope: 'text-input',
    ...valueField,
  },
  {
    name: 'datetime',
    loadComponent: () =>
      import('./spartan-datetime-field').then(
        ({ SpartanDateTimeFieldComponent }) => SpartanDateTimeFieldComponent,
      ),
    mapper: datepickerFieldMapper,
    scope: 'date',
    ...valueField,
  },
  {
    name: 'select',
    loadComponent: () =>
      import('./spartan-select-field').then(
        ({ SpartanSelectFieldComponent }) => SpartanSelectFieldComponent,
      ),
    mapper: optionsFieldMapper,
    scope: 'single-select',
    ...valueField,
  },
  {
    name: 'checkbox',
    loadComponent: () =>
      import('./spartan-checkbox-field').then(
        ({ SpartanCheckboxFieldComponent }) => SpartanCheckboxFieldComponent,
      ),
    mapper: checkboxFieldMapper,
    scope: 'boolean',
    ...valueField,
  },
  {
    name: 'submit',
    loadComponent: () =>
      import('./spartan-submit-field').then(
        ({ SpartanSubmitFieldComponent }) => SpartanSubmitFieldComponent,
      ),
    mapper: submitButtonFieldMapper,
    renderReadyWhen: [],
    valueHandling: 'exclude',
  },
];

export const provideSpartanDynamicForm = (): EnvironmentProviders =>
  provideDynamicForm(...SPARTAN_FIELD_TYPES, withLoggerConfig(false));
