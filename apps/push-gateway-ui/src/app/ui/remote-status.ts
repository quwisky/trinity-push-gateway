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
  template: `
    @let remoteState = state();
    @switch (remoteState.kind) {
      @case ('idle') {
        <p class="remote-status muted">Waiting to load {{ label() }}.</p>
      }
      @case ('loading') {
        <p class="remote-status muted" role="status">Loading {{ label() }}…</p>
      }
      @case ('fresh') {
        <p class="remote-status muted">
          Last updated
          <time [attr.datetime]="isoObservedAt()">{{
            formattedObservedAt()
          }}</time>
          ({{ time.zoneLabel() }}).
        </p>
      }
      @case ('stale') {
        <div class="remote-status warning-message" role="status">
          <p>
            Showing the last successful {{ label() }} from
            <time [attr.datetime]="isoObservedAt()">{{
              formattedObservedAt()
            }}</time>
            ({{ time.zoneLabel() }}). {{ remoteState.problem.title }}
          </p>
          <button
            hlmBtn
            variant="outline"
            size="sm"
            type="button"
            (click)="retry.emit()"
          >
            Retry
          </button>
        </div>
      }
      @case ('error') {
        <div class="remote-status error-message" role="alert">
          <p>
            {{ remoteState.problem.title }}
            @if (remoteState.problem.detail; as detail) {
              {{ detail }}
            }
          </p>
          <button
            hlmBtn
            variant="outline"
            size="sm"
            type="button"
            (click)="retry.emit()"
          >
            Retry
          </button>
        </div>
      }
    }
  `,
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
