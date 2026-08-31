import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { disabled, required } from '@angular/forms/signals';
import {
  createNgForgeActionFixture,
  createNgForgeFieldFixture,
} from '@ng-forge/dynamic-forms/testing';
import { SpartanCheckboxFieldComponent } from './spartan-checkbox-field';
import { SpartanDateTimeFieldComponent } from './spartan-datetime-field';
import { SpartanSelectFieldComponent } from './spartan-select-field';
import { SpartanSubmitFieldComponent } from './spartan-submit-field';
import { SpartanTextFieldComponent } from './spartan-text-field';

describe('shared Spartan dynamic form fields', () => {
  it('binds text values and exposes validation errors accessibly', async () => {
    const { fixture, field, rootValue } = createNgForgeFieldFixture(
      SpartanTextFieldComponent,
      {
        key: 'search',
        value: '',
        touched: true,
        schema: (path) => {
          required(path, { message: 'Search is required.' });
        },
        inputs: {
          label: 'Operation type',
          placeholder: 'For example, backup',
          tabIndex: 2,
          props: {
            type: 'search',
            hint: 'Filters locally without sending a request.',
          },
        },
      },
    );

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector<HTMLInputElement>('input');
    const label = root.querySelector('label');
    const error = root.querySelector('[role="alert"]');

    expect(input).not.toBeNull();
    expect(label?.textContent.trim()).toBe('Operation type');
    expect(label?.getAttribute('for')).toBe('search-input');
    expect(input?.type).toBe('search');
    expect(input?.placeholder).toBe('For example, backup');
    expect(input?.tabIndex).toBe(2);
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(input?.getAttribute('aria-required')).toBe('true');
    expect(input?.getAttribute('aria-describedby')).toBe('search-error');
    expect(error?.id).toBe('search-error');
    expect(error?.textContent.trim()).toBe('Search is required.');

    if (!input) {
      throw new Error('Expected the text field input.');
    }
    input.value = 'backup';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(rootValue()['search']).toBe('backup');
    expect(field().touched()).toBe(true);
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.querySelector('.field-hint')?.id).toBe('search-hint');
    expect(input.getAttribute('aria-describedby')).toBe('search-hint');
  });

  it('binds datetime values, touch state, hints, and disabled state', async () => {
    const disabledState = signal(false);
    const { fixture, field, rootValue } = createNgForgeFieldFixture(
      SpartanDateTimeFieldComponent,
      {
        key: 'since',
        value: '2026-08-31T10:00',
        schema: (path) => {
          disabled(path, { when: () => disabledState() });
        },
        inputs: {
          label: 'Observed since',
          tabIndex: 3,
          props: { hint: 'Uses the browser locale for input only.' },
        },
      },
    );

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector<HTMLInputElement>('input');

    expect(input?.type).toBe('datetime-local');
    expect(input?.value).toBe('2026-08-31T10:00');
    expect(input?.getAttribute('aria-describedby')).toBe('since-hint');
    expect(root.querySelector('.field-hint')?.textContent.trim()).toBe(
      'Uses the browser locale for input only.',
    );

    if (!input) {
      throw new Error('Expected the datetime field input.');
    }
    input.value = '2026-09-01T12:30';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(rootValue()['since']).toBe('2026-09-01T12:30');
    expect(field().touched()).toBe(true);

    disabledState.set(true);
    TestBed.tick();
    fixture.detectChanges();
    expect(field().disabled()).toBe(true);
    expect(input.disabled).toBe(true);
  });

  it('binds select options, values, touch state, and accessibility metadata', async () => {
    const { fixture, field, rootValue } = createNgForgeFieldFixture(
      SpartanSelectFieldComponent,
      {
        key: 'outcome',
        value: 'all',
        inputs: {
          label: 'Outcome',
          tabIndex: 4,
          props: { hint: 'Filters by the safe operation outcome.' },
          options: [
            { value: 'all', label: 'All outcomes' },
            { value: 'succeeded', label: 'Succeeded' },
            { value: 'failed', label: 'Failed', disabled: true },
          ],
        },
      },
    );

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const select = root.querySelector<HTMLSelectElement>('select');
    const options = Array.from(root.querySelectorAll('option'));

    expect(select?.id).toBe('outcome-select');
    expect(select?.value).toBe('all');
    expect(select?.tabIndex).toBe(4);
    expect(options.map((option) => option.textContent.trim())).toEqual([
      'All outcomes',
      'Succeeded',
      'Failed',
    ]);
    expect(options[2]?.disabled).toBe(true);
    expect(select?.getAttribute('aria-describedby')).toBe('outcome-hint');

    if (!select) {
      throw new Error('Expected the native select field.');
    }
    select.value = 'succeeded';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(rootValue()['outcome']).toBe('succeeded');
    expect(field().touched()).toBe(true);
  });

  it('binds checkbox values, touch state, labels, and disabled state', async () => {
    const disabledState = signal(false);
    const { fixture, field, rootValue } = createNgForgeFieldFixture(
      SpartanCheckboxFieldComponent,
      {
        key: 'includeCompleted',
        value: false,
        schema: (path) => {
          disabled(path, { when: () => disabledState() });
        },
        inputs: {
          label: 'Include completed operations',
          tabIndex: 6,
          props: { hint: 'Includes completed operation summaries.' },
        },
      },
    );

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const checkbox = root.querySelector<HTMLButtonElement>(
      'button[role="checkbox"]',
    );
    const label = root.querySelector('label');

    expect(label?.textContent.trim()).toBe('Include completed operations');
    expect(label?.getAttribute('for')).toBe('includeCompleted-checkbox');
    expect(checkbox?.id).toBe('includeCompleted-checkbox');
    expect(checkbox?.tabIndex).toBe(6);
    expect(checkbox?.getAttribute('aria-checked')).toBe('false');
    expect(checkbox?.getAttribute('aria-describedby')).toBe(
      'includeCompleted-hint',
    );

    if (!checkbox) {
      throw new Error('Expected the checkbox field button.');
    }
    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(rootValue()['includeCompleted']).toBe(true);
    expect(field().touched()).toBe(true);
    expect(checkbox.getAttribute('aria-checked')).toBe('true');

    disabledState.set(true);
    TestBed.tick();
    fixture.detectChanges();
    expect(field().disabled()).toBe(true);
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.tabIndex).toBe(-1);
  });

  it('renders the submit action label, tab order, and disabled state', async () => {
    const { fixture } = createNgForgeActionFixture(
      SpartanSubmitFieldComponent,
      {
        key: 'apply',
        label: 'Apply filters',
        disabled: true,
        inputs: { tabIndex: 5 },
      },
    );

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector<HTMLButtonElement>('button');

    expect(button?.type).toBe('submit');
    expect(button?.textContent.trim()).toBe('Apply filters');
    expect(button?.tabIndex).toBe(-1);
    expect(button?.disabled).toBe(true);
    expect(root.getAttribute('aria-disabled')).toBe('true');

    fixture.componentRef.setInput('disabled', false);
    fixture.detectChanges();
    expect(button?.disabled).toBe(false);
    expect(button?.tabIndex).toBe(5);
    expect(root.getAttribute('aria-disabled')).toBeNull();
  });
});
