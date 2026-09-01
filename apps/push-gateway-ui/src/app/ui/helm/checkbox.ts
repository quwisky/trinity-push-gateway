import { BooleanInput } from '@angular/cdk/coercion';
import {
  afterRenderEffect,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  linkedSignal,
  model,
  output,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { BrnCheckbox } from '@spartan-ng/brain/checkbox';
import { BrnFieldControlDescribedBy } from '@spartan-ng/brain/field';
import { ChangeFn, TouchFn } from '@spartan-ng/brain/forms';
import { ClassValue } from 'clsx';
import { hlm } from './hlm';

const HLM_CHECKBOX_VALUE_ACCESSOR = {
  provide: NG_VALUE_ACCESSOR,
  useExisting: forwardRef(() => HlmCheckbox),
  multi: true,
};

@Component({
  selector: 'hlm-checkbox',
  imports: [BrnCheckbox],
  providers: [HLM_CHECKBOX_VALUE_ACCESSOR],
  hostDirectives: [BrnFieldControlDescribedBy],
  host: {
    class: 'contents peer',
    'data-slot': 'checkbox',
    '[attr.data-disabled]': 'disabledState() ? "" : null',
  },
  templateUrl: './checkbox.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HlmCheckbox implements ControlValueAccessor {
  readonly userClass = input<ClassValue>('', { alias: 'class' });
  readonly inputId = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null, { alias: 'aria-label' });
  readonly ariaLabelledby = input<string | null>(null, {
    alias: 'aria-labelledby',
  });
  readonly ariaDescribedby = input<string | null>(null, {
    alias: 'aria-describedby',
  });
  readonly checkedInput = input<boolean, BooleanInput>(false, {
    alias: 'checked',
    transform: booleanAttribute,
  });
  readonly checked = linkedSignal(this.checkedInput);
  readonly checkedChange = output<boolean>();
  readonly indeterminate = model(false);
  readonly name = input<string | null>(null);
  readonly required = input<boolean, BooleanInput>(false, {
    transform: booleanAttribute,
  });
  readonly disabled = input<boolean, BooleanInput>(false, {
    transform: booleanAttribute,
  });
  readonly forceInvalid = input<boolean, BooleanInput>(false, {
    transform: booleanAttribute,
  });
  readonly tabIndex = input<number | undefined>(undefined);

  protected readonly disabledState = linkedSignal(this.disabled);
  private readonly brainCheckbox = viewChild.required(BrnCheckbox);
  private readonly spartanInvalid = computed(
    () => this.forceInvalid() || this.brainCheckbox().spartanInvalid(),
  );
  protected readonly computedClass = computed(() =>
    hlm(
      'spartan-checkbox peer shrink-0 cursor-default outline-none disabled:cursor-not-allowed disabled:opacity-50',
      this.userClass(),
      this.spartanInvalid()
        ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20'
        : '',
    ),
  );

  protected onChange?: ChangeFn<boolean>;
  protected onTouched?: TouchFn;

  constructor() {
    afterRenderEffect(() => {
      this.brainCheckbox().checkbox().nativeElement.tabIndex =
        this.disabledState() ? -1 : (this.tabIndex() ?? 0);
    });
  }

  protected handleChange(value: boolean): void {
    if (this.disabledState()) {
      return;
    }
    this.checked.set(value);
    this.checkedChange.emit(value);
    this.onChange?.(value);
  }

  writeValue(value: boolean): void {
    this.checked.set(value);
  }

  registerOnChange(callback: ChangeFn<boolean>): void {
    this.onChange = callback;
  }

  registerOnTouched(callback: TouchFn): void {
    this.onTouched = callback;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledState.set(isDisabled);
  }
}
