import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  input,
  OnDestroy,
  viewChild,
} from '@angular/core';
import {
  CategoryScale,
  Chart,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
);

@Component({
  selector: 'tpg-gateway-chart',
  template: `
    <div class="chart-frame">
      <canvas #canvas role="img" [attr.aria-label]="accessibleLabel()"></canvas>
    </div>
    <table class="data-table compact-table">
      <caption class="visually-hidden">
        {{
          accessibleLabel()
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">Interval</th>
          <th scope="col">Count</th>
        </tr>
      </thead>
      <tbody>
        @for (label of labels(); track label; let index = $index) {
          <tr>
            <th scope="row">{{ label }}</th>
            <td>{{ values()[index] }}</td>
          </tr>
        }
      </tbody>
    </table>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GatewayChart implements OnDestroy {
  readonly labels = input.required<readonly string[]>();
  readonly values = input.required<readonly number[]>();
  readonly accessibleLabel = input.required<string>();

  private readonly canvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart<'line'>;

  constructor() {
    afterNextRender(() => {
      this.createChart();
    });
    effect(() => {
      const labels = [...this.labels()];
      const values = [...this.values()];
      if (!this.chart) {
        return;
      }
      const dataset = this.chart.data.datasets[0];
      this.chart.data.labels = labels;
      dataset.data = values;
      this.chart.update('none');
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private createChart(): void {
    this.chart = new Chart(this.canvas().nativeElement, {
      type: 'line',
      data: {
        labels: [...this.labels()],
        datasets: [
          {
            data: [...this.values()],
            borderColor: '#0f766e',
            backgroundColor: '#0f766e',
            pointRadius: 3,
            tension: 0.2,
          },
        ],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        plugins: { tooltip: { enabled: true } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  }
}
