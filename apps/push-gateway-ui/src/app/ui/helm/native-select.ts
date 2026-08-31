import { BooleanInput } from '@angular/cdk/coercion';
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown } from '@ng-icons/lucide';
import { BrnFieldControl, provideBrnLabelable } from '@spartan-ng/brain/field';
import { ChangeFn, TouchFn } from '@spartan-ng/brain/forms';
import { ClassValue } from 'clsx';
import { hlm } from './hlm';

const HLM_NATIVE_SELECT_VALUE_ACCESSOR = {
  provide: NG_VALUE_ACCESSOR,
  useExisting: forwardRef(() => HlmNativeSelect),
  multi: true,
};

@Component({
  selector: 'hlm-native-select',
  imports: [NgIcon],
  providers: [
    HLM_NATIVE_SELECT_VALUE_ACCESSOR,
    provideIcons({ lucideChevronDown }),
    provideBrnLabelable(HlmNativeSelect),
  ],
  hostDirectives: [BrnFieldControl],
  host: {
    class:
      'spartan-native-select-wrapper group/native-select relative block w-full has-[select:disabled]:opacity-50',
    'data-slot': 'native-select-wrapper',
  },
  template: `
    <select
      data-slot="native-select"
      [id]="selectId()"
      [class]="computedSelectClass()"
      [attr.aria-invalid]="ariaInvalid() ? 'true' : null"
      [tabIndex]="disabledState() ? -1 : (tabIndex() ?? 0)"
      [value]="value()"
      [disabled]="disabledState()"
      (change)="valueChanged($event)"
      (blur)="blurred()"
    >
      <ng-content />
    </select>
    <ng-icon
      name="lucideChevronDown"
      class="spartan-native-select-icon pointer-events-none absolute select-none"
      aria-hidden="true"
      data-slot="native-select-icon"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HlmNativeSelect implements ControlValueAccessor {
  private static nextId = 0;
  private readonly fieldControl = inject(BrnFieldControl, { optional: true });

  readonly selectId = input(
    `hlm-native-select-${String(HlmNativeSelect.nextId++)}`,
  );
  readonly selectClass = input<ClassValue>('');
  readonly disabled = input<boolean, BooleanInput>(false, {
    transform: booleanAttribute,
  });
  readonly forceInvalid = input<boolean, BooleanInput>(false, {
    transform: booleanAttribute,
  });
  readonly tabIndex = input<number | undefined>(undefined);
  readonly valueInput = input<string | null>('', { alias: 'value' });
  readonly value = linkedSignal(this.valueInput);
  readonly valueChange = output<string | null>();
  readonly labelableId = this.selectId;

  protected readonly disabledState = linkedSignal(this.disabled);
  protected readonly ariaInvalid = computed(
    () => this.forceInvalid() || this.fieldControl?.invalid(),
  );
  protected readonly computedSelectClass = computed(() =>
    hlm(
      'spartan-native-select w-full outline-none disabled:pointer-events-none disabled:cursor-not-allowed',
      this.selectClass(),
    ),
  );

  protected onChange?: ChangeFn<string | null>;
  protected onTouched?: TouchFn;

  protected valueChanged(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.value.set(value);
    this.valueChange.emit(value);
    this.onChange?.(value);
    this.onTouched?.();
  }

  protected blurred(): void {
    this.onTouched?.();
  }

  writeValue(value: string | null): void {
    this.value.set(value);
  }

  registerOnChange(callback: ChangeFn<string | null>): void {
    this.onChange = callback;
  }

  registerOnTouched(callback: TouchFn): void {
    this.onTouched = callback;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledState.set(isDisabled);
  }
}
