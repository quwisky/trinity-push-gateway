import { ChangeDetectionStrategy, Component } from '@angular/core';
import { GatewayChart } from './gateway-chart';

@Component({
  selector: 'tpg-metrics-page',
  imports: [GatewayChart],
  template: `
    <header class="page-header">
      <p class="eyebrow">Privacy-preserving aggregates</p>
      <h1>Metrics</h1>
      <p class="lede">
        Fixed-cardinality outcomes without request, account, or installation
        identifiers.
      </p>
    </header>

    <section class="content-panel" aria-labelledby="request-outcomes-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Foundation preview</p>
          <h2 id="request-outcomes-title">Notification Request outcomes</h2>
        </div>
        <span class="status-pill">Not connected</span>
      </div>
      <tpg-gateway-chart
        [labels]="labels"
        [values]="values"
        accessibleLabel="Notification Request outcome counts. Operational data is not connected."
      />
      <p class="muted">
        The chart wrapper is loaded only with this route. Live aggregate polling
        is implemented by a later operational feature task.
      </p>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricsPage {
  protected readonly labels = ['Processed', 'Invalid', 'Rate limited'];
  protected readonly values = [0, 0, 0];
}
