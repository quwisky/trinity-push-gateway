import { TestBed } from '@angular/core/testing';
import { DynamicFormLogger, NoopLogger } from '@ng-forge/dynamic-forms';
import {
  ADDON_TYPE_COMPONENT_CACHE,
  FIELD_REGISTRY,
} from '@ng-forge/dynamic-forms/integration';
import {
  provideSpartanDynamicForm,
  SPARTAN_FIELD_TYPES,
} from './spartan-form.provider';

describe('SPARTAN_FIELD_TYPES', () => {
  it('registers only the five application-owned field types', () => {
    expect(SPARTAN_FIELD_TYPES.map(({ name }) => name)).toEqual([
      'input',
      'datetime',
      'select',
      'checkbox',
      'submit',
    ]);
  });

  it('keeps every field component behind its lazy loader', async () => {
    for (const definition of SPARTAN_FIELD_TYPES) {
      const { loadComponent } = definition;
      if (!loadComponent) {
        throw new Error(`Field type ${definition.name} must load lazily.`);
      }
      const component = await loadComponent();
      expect(component).toBeTypeOf('function');
    }
  });

  it('provides only the application registry without ng-forge defaults', () => {
    TestBed.configureTestingModule({
      providers: [provideSpartanDynamicForm()],
    });

    expect([...TestBed.inject(FIELD_REGISTRY).keys()]).toEqual([
      'input',
      'datetime',
      'select',
      'checkbox',
      'submit',
    ]);
    expect(TestBed.inject(DynamicFormLogger)).toBeInstanceOf(NoopLogger);
    expect(TestBed.inject(ADDON_TYPE_COMPONENT_CACHE)).toBeInstanceOf(Map);
  });
});
