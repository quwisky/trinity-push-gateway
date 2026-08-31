import { Directive } from '@angular/core';
import { BrnLabel } from '@spartan-ng/brain/label';

@Directive({
  selector: '[hlmLabel]',
  hostDirectives: [{ directive: BrnLabel, inputs: ['id', 'for'] }],
  host: {
    'data-slot': 'label',
    class:
      'spartan-label flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed',
  },
})
export class HlmLabel {}
