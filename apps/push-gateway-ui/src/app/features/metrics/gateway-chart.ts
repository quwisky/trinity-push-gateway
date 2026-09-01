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
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
);

export type GatewayChartSeries = Readonly<{
  label: string;
  values: readonly (number | null)[];
  color: string;
}>;

@Component({
  selector: 'tpg-gateway-chart',
  templateUrl: './gateway-chart.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GatewayChart implements OnDestroy {
  readonly labels = input.required<readonly string[]>();
  readonly series = input.required<readonly GatewayChartSeries[]>();
  readonly accessibleLabel = input.required<string>();
  readonly tableCaption = input.required<string>();
  readonly type = input<'bar' | 'line'>('bar');
  readonly stacked = input(false);
  readonly valueSuffix = input('');

  private readonly canvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart;

  constructor() {
    afterNextRender(() => {
      this.createChart();
    });
    effect(() => {
      const labels = [...this.labels()];
      const datasets = this.chartDatasets();
      if (!this.chart) {
        return;
      }
      this.chart.data.labels = labels;
      this.chart.data.datasets = datasets;
      this.chart.update('none');
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  protected displayValue(value: number | null | undefined): string {
    return value === null || value === undefined
      ? 'No samples'
      : `${new Intl.NumberFormat().format(value)}${this.valueSuffix()}`;
  }

  private chartDatasets(): Chart['data']['datasets'] {
    return this.series().map((seriesItem) => ({
      type: this.type(),
      label: seriesItem.label,
      data: [...seriesItem.values],
      backgroundColor: seriesItem.color,
      borderColor: seriesItem.color,
      borderWidth: this.type() === 'line' ? 2 : 1,
      pointRadius: this.type() === 'line' ? 2 : 0,
      tension: this.type() === 'line' ? 0.2 : 0,
    }));
  }

  private createChart(): void {
    this.chart = new Chart(this.canvas().nativeElement, {
      type: this.type(),
      data: {
        labels: [...this.labels()],
        datasets: this.chartDatasets(),
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'bottom' },
          tooltip: { enabled: true },
        },
        scales: {
          x: { stacked: this.stacked() },
          y: {
            beginAtZero: true,
            stacked: this.stacked(),
            ticks: { precision: 0 },
          },
        },
      },
    });
  }
}
