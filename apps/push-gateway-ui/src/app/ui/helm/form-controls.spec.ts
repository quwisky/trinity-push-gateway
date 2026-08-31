import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HlmButton } from './button';
import { HlmCheckbox } from './checkbox';
import { HlmInput } from './input';
import { HlmLabel } from './label';
import { HlmNativeSelect } from './native-select';

@Component({
  selector: 'tpg-test-form-primitives',
  imports: [HlmButton, HlmInput, HlmLabel],
  template: `
    <label hlmLabel for="query">Query</label>
    <input hlmInput id="query" placeholder="Search" />
    <button hlmBtn variant="secondary" type="button">Apply</button>
  `,
})
class TestFormPrimitives {}

describe('application-owned Helm form controls', () => {
  it('composes the label, input, and button primitives with stable slots', async () => {
    await TestBed.configureTestingModule({
      imports: [TestFormPrimitives],
    }).compileComponents();
    const fixture = TestBed.createComponent(TestFormPrimitives);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('label')?.dataset['slot']).toBe('label');
    expect(root.querySelector('input')?.dataset['slot']).toBe('input');
    expect(root.querySelector('button')?.dataset['slot']).toBe('button');
    expect(root.querySelector('label')?.getAttribute('for')).toBe('query');
  });

  it('propagates checkbox value, disabled, and accessible state', async () => {
    await TestBed.configureTestingModule({
      imports: [HlmCheckbox],
    }).compileComponents();
    const fixture = TestBed.createComponent(HlmCheckbox);
    fixture.componentRef.setInput('inputId', 'cleanup-enabled');
    fixture.componentRef.setInput('aria-label', 'Enable cleanup');
    fixture.componentRef.setInput('tabIndex', 3);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const control = fixture.componentInstance;
    const onChange = vi.fn<(value: boolean) => void>();
    control.registerOnChange(onChange);
    const checkbox = root.querySelector<HTMLButtonElement>(
      'button[role="checkbox"]',
    );

    if (!checkbox) {
      throw new Error('Expected the rendered checkbox button.');
    }

    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(onChange).toHaveBeenCalledWith(true);
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(checkbox.getAttribute('aria-label')).toBe('Enable cleanup');
    expect(checkbox.tabIndex).toBe(3);

    control.setDisabledState(true);
    fixture.detectChanges();

    expect(checkbox.disabled).toBe(true);
    expect(checkbox.tabIndex).toBe(-1);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('propagates native select value, touch, and disabled state', async () => {
    await TestBed.configureTestingModule({
      imports: [HlmNativeSelect],
    }).compileComponents();
    const fixture = TestBed.createComponent(HlmNativeSelect);
    fixture.componentRef.setInput('selectId', 'platform');
    fixture.componentRef.setInput('tabIndex', 4);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const control = fixture.componentInstance;
    const select = root.querySelector<HTMLSelectElement>('select');

    if (!select) {
      throw new Error('Expected the rendered native select.');
    }
    select.add(new Option('Android', 'android'));
    select.add(new Option('iOS', 'ios'));
    const onChange = vi.fn<(value: string | null) => void>();
    const onTouched = vi.fn<() => void>();
    control.registerOnChange(onChange);
    control.registerOnTouched(onTouched);

    control.writeValue('ios');
    fixture.detectChanges();
    expect(select.value).toBe('ios');
    expect(select.tabIndex).toBe(4);

    select.value = 'android';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(onChange).toHaveBeenCalledWith('android');
    expect(onTouched).toHaveBeenCalledOnce();

    control.setDisabledState(true);
    fixture.detectChanges();
    expect(select.disabled).toBe(true);
    expect(select.tabIndex).toBe(-1);
  });
});
