import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { PuntoGrafica } from '../../constants/graficas';
import { NumeroPipe, formatearNumero } from '../../constants/formato';

// Solo registramos lo que usan estas gráficas (línea, barras, relleno y
// tooltip), en vez de 'chart.js/auto', que carga todos los tipos de gráfica
Chart.register(
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
);

/**
 * Tarjeta con la gráfica de una métrica guardada en el historial local.
 * Es la misma para todos los dispositivos, para mantener la coherencia visual.
 * Si no hay puntos en el rango elegido, se pliega y muestra "Sin datos".
 */
@Component({
  selector: 'app-grafica-historico',
  templateUrl: './grafica-historico.component.html',
  styleUrls: ['./grafica-historico.component.scss'],
  standalone: true,
  imports: [CommonModule, NumeroPipe],
})
export class GraficaHistoricoComponent
  implements AfterViewInit, OnChanges, OnDestroy
{
  @Input() titulo = '';
  @Input() unidad = '';
  @Input() color = '#007aff';
  @Input() tipo: 'line' | 'bar' = 'line';
  @Input() puntos: PuntoGrafica[] = [];
  @Input() decimales = 0;

  @ViewChild('lienzo') private lienzo!: ElementRef<HTMLCanvasElement>;
  private grafica?: Chart;

  /** Valor de la medición más reciente, que se muestra junto al título. */
  get ultimoValor(): number | null {
    return this.puntos[this.puntos.length - 1]?.valor ?? null;
  }

  ngAfterViewInit() {
    this.crearGrafica();
  }

  ngOnChanges() {
    this.actualizarGrafica();
  }

  ngOnDestroy() {
    this.grafica?.destroy();
  }

  /** Crea la gráfica con el estilo común. Se llama una vez, al tener el canvas. */
  private crearGrafica() {
    // El fondo de la línea es el mismo color con un 10 % de opacidad
    const fondo = this.tipo === 'line' ? `${this.color}1a` : this.color;

    this.grafica = new Chart(this.lienzo.nativeElement, {
      type: this.tipo,
      data: {
        labels: [],
        datasets: [
          {
            data: [],
            borderColor: this.color,
            backgroundColor: fondo,
            borderWidth: 2,
            borderRadius: 4,
            pointRadius: 2,
            tension: 0.3,
            fill: this.tipo === 'line',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (contexto) =>
                `${formatearNumero(contexto.parsed.y, this.decimales)} ${this.unidad}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#8e8e93', maxTicksLimit: 5, maxRotation: 0 },
          },
          y: {
            grid: { color: '#e5e5ea' },
            ticks: {
              color: '#8e8e93',
              maxTicksLimit: 5,
              callback: (valor) => formatearNumero(valor, this.decimales),
            },
          },
        },
      },
    });
    this.actualizarGrafica();
  }

  /** Sustituye los datos de la gráfica por los puntos recibidos. */
  private actualizarGrafica() {
    if (!this.grafica) return; // Aún no existe el canvas

    this.grafica.data.labels = this.puntos.map((p) => formatearFecha(p.fecha));
    this.grafica.data.datasets[0].data = this.puntos.map((p) => p.valor);
    this.grafica.update();
  }
}

/** Formatea una fecha ISO como "dd/mm hh:mm". */
function formatearFecha(fechaISO: string): string {
  const f = new Date(fechaISO);
  const dd = (n: number) => n.toString().padStart(2, '0');
  const dia = `${dd(f.getDate())}/${dd(f.getMonth() + 1)}`;
  return `${dia} ${dd(f.getHours())}:${dd(f.getMinutes())}`;
}
