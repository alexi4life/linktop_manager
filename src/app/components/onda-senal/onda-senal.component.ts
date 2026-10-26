import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  NgZone,
  OnDestroy,
  ViewChild,
} from '@angular/core';

/**
 * Dibuja en un canvas una señal en tiempo real (ECG, PPG, onda de oxígeno...).
 * Es la misma para todos los dispositivos: rectangular con cuadrícula o
 * circular (tipo ojo de buey), con la escala ajustada automáticamente.
 *
 * Uso: el padre obtiene el componente con @ViewChild y llama a `agregar()` con
 * los puntos nuevos y a `limpiar()` al empezar otra medición.
 */
@Component({
  selector: 'app-onda-senal',
  templateUrl: './onda-senal.component.html',
  styleUrls: ['./onda-senal.component.scss'],
  standalone: true,
})
export class OndaSenalComponent implements AfterViewInit, OnDestroy {
  /** Color de la onda. */
  @Input() color = '#ff2d55';

  /** true para dibujarla dentro de un círculo en vez de un rectángulo. */
  @Input() circular = false;

  /** Cuántos puntos recientes se muestran a la vez. */
  @Input() capacidad = 600;

  @ViewChild('lienzo', { static: true })
  private lienzo!: ElementRef<HTMLCanvasElement>;

  private puntos: number[] = [];
  private hayCambios = false;
  private fotograma = 0;

  constructor(private zona: NgZone) {}

  ngAfterViewInit() {
    this.ajustarTamano();

    // Fuera de la zona de Angular: redibujar no debe disparar detección de cambios
    this.zona.runOutsideAngular(() => {
      const bucle = () => {
        if (this.hayCambios) {
          this.hayCambios = false;
          this.dibujar();
        }
        this.fotograma = requestAnimationFrame(bucle);
      };
      bucle();
    });
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.fotograma);
  }

  /** Añade puntos nuevos al final de la onda. */
  agregar(valores: number[]) {
    this.puntos.push(...valores);
    if (this.puntos.length > this.capacidad) {
      this.puntos.splice(0, this.puntos.length - this.capacidad);
    }
    this.hayCambios = true;
  }

  /** Borra la onda, para empezar una medición nueva. */
  limpiar() {
    this.puntos = [];
    this.hayCambios = true;
  }

  /** Fija la resolución del canvas según el espacio disponible. */
  private ajustarTamano() {
    const canvas = this.lienzo.nativeElement;
    if (this.circular) {
      canvas.width = canvas.height = 180;
    } else {
      canvas.width = 600; // Resolución fija; el CSS la ajusta al ancho de la tarjeta
      canvas.height = 140;
    }
    this.hayCambios = true;
  }

  /** Pinta la cuadrícula y la onda, autoescalada al rango de los puntos visibles. */
  private dibujar() {
    const canvas = this.lienzo.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ancho = canvas.width;
    const alto = canvas.height;

    ctx.clearRect(0, 0, ancho, alto);
    ctx.save();
    if (this.circular) {
      ctx.beginPath();
      ctx.arc(ancho / 2, alto / 2, ancho / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ancho, alto);

    // Cuadrícula gris clara, discreta sobre fondo blanco
    ctx.strokeStyle = '#e5e5ea';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < ancho; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, alto);
      ctx.stroke();
    }
    for (let y = 0; y < alto; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ancho, y);
      ctx.stroke();
    }

    if (this.puntos.length >= 2) {
      const max = this.puntos.reduce((a, b) => Math.max(a, b), -Infinity);
      const min = this.puntos.reduce((a, b) => Math.min(a, b), Infinity);
      const margen = (max - min) * 0.2;
      const rango = max - min + margen * 2 || 1;
      const base = min - margen;
      const pasoX = ancho / (this.puntos.length - 1);

      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.puntos.forEach((punto, i) => {
        const y = alto - ((punto - base) / rango) * (alto * 0.8) - alto * 0.1;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * pasoX, y);
      });
      ctx.stroke();
    }
    ctx.restore();
  }
}
