import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'tpg-overview-page',
  template: `
    <header class="page-header">
      <p class="eyebrow">Deployment</p>
      <h1>Overview</h1>
      <p class="lede">
        A privacy-preserving summary of gateway readiness and recent delivery
        outcomes.
      </p>
    </header>

    <section class="panel-grid" aria-label="Overview status">
      <article class="status-card">
        <span class="status-label">Gateway delivery</span>
        <strong>Independent</strong>
        <p>Matrix notification delivery does not depend on this interface.</p>
      </article>
      <article class="status-card">
        <span class="status-label">Administration</span>
        <strong>Session protected</strong>
        <p>Only bounded, same-origin operator capabilities are exposed.</p>
      </article>
      <article class="status-card">
        <span class="status-label">Data boundary</span>
        <strong>Aggregate only</strong>
        <p>No Matrix identifiers, Push Keys, or notification content appear.</p>
      </article>
    </section>

    <section class="empty-state" aria-labelledby="overview-data-title">
      <h2 id="overview-data-title">Administration foundation connected</h2>
      <p>
        This authenticated shell is served by the isolated Bun administration
        service. Delivery aggregates and operator actions arrive in the next
        focused capabilities.
      </p>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewPage {}
