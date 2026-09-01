import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import type { RemoteState } from '../api/remote-resource';
import { TimeService } from '../core/time/time.service';
import { HlmButton } from './helm/button';

@Component({
  selector: 'tpg-remote-status',
  imports: [HlmButton],
  templateUrl: './remote-status.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RemoteStatus {
  readonly state = input.required<RemoteState<unknown>>();
  readonly label = input('data');
  readonly retry = output();
  protected readonly time = inject(TimeService);

  protected isoObservedAt(): string | undefined {
    const state = this.state();
    return state.kind === 'fresh' || state.kind === 'stale'
      ? new Date(state.observedAt).toISOString()
      : undefined;
  }

  protected formattedObservedAt(): string {
    const state = this.state();
    return state.kind === 'fresh' || state.kind === 'stale'
      ? this.time.format(state.observedAt)
      : '';
  }
}
