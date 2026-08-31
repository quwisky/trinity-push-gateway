import { computed, Directive, inject, input } from '@angular/core';
import { BrnButton } from '@spartan-ng/brain/button';
import { cva, VariantProps } from 'class-variance-authority';
import { ClassValue } from 'clsx';
import { hlm } from './hlm';

export const buttonVariants = cva(
  'spartan-button group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'spartan-button-variant-default',
        outline: 'spartan-button-variant-outline',
        secondary: 'spartan-button-variant-secondary',
        ghost: 'spartan-button-variant-ghost',
        destructive: 'spartan-button-variant-destructive',
        link: 'spartan-button-variant-link',
      },
      size: {
        default: 'spartan-button-size-default',
        sm: 'spartan-button-size-sm',
        lg: 'spartan-button-size-lg',
        icon: 'spartan-button-size-icon',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

type ButtonVariants = VariantProps<typeof buttonVariants>;

@Directive({
  selector: 'button[hlmBtn], a[hlmBtn]',
  exportAs: 'hlmBtn',
  hostDirectives: [{ directive: BrnButton, inputs: ['disabled'] }],
  host: {
    'data-slot': 'button',
    '[class]': 'computedClass()',
    '[attr.tabindex]': 'computedTabIndex()',
  },
})
export class HlmButton {
  private readonly brainButton = inject(BrnButton);

  readonly userClass = input<ClassValue>('', { alias: 'class' });
  readonly variant = input<ButtonVariants['variant']>('default');
  readonly size = input<ButtonVariants['size']>('default');
  readonly tabIndex = input<number | undefined>(undefined);
  protected readonly computedClass = computed(() =>
    hlm(
      buttonVariants({ variant: this.variant(), size: this.size() }),
      this.userClass(),
    ),
  );
  protected readonly computedTabIndex = computed(() =>
    this.brainButton.disabled() ? -1 : this.tabIndex(),
  );
}
