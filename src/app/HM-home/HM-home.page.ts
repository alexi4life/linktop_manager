import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonCard,
  IonCardContent,
  IonSpinner,
  IonIcon,
  IonSegment,
  IonSegmentButton,
  IonLabel,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { FormsModule } from '@angular/forms';
import {
  thermometerOutline,
  waterOutline,
  pulseOutline,
  batteryHalfOutline,
  heartOutline,
  checkmarkCircle,
  warningOutline,
} from 'ionicons/icons';
import { LinktopService } from '../services/HM-linktop';
import { CommonModule } from '@angular/common';
import { HistorialService } from '../services/HM-historial.service';
import Chart from 'chart.js/auto';

@Component({
  selector: 'app-home',
  templateUrl: 'HM-home.page.html',
  styleUrls: ['HM-home.page.scss'],
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButton,
    IonCard,
    IonCardContent,
    IonSpinner,
    IonIcon,
    CommonModule,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    FormsModule,
  ],
})
export class HomePage implements OnInit {
  // VARIABLES DEL BLUETOOTH
  estadoBluetooth: string = 'Bluetooth apagado';
  conectado: boolean = false;

  // VARIABLES TEMPERATURA
  midiendoBT: boolean = false;
  temperatura: number | null = null;

  // VARIABLES DEL SENSOR DE OXÍGENO
  midiendoOX: boolean = false;
  spo2: number | null = null;
  pulso: number | null = null;
  dedoPuesto: boolean = true;
  errorOxigeno: string | null = null;

  // VARIABLES BATERÍA
  bateria: number | null = null;
  cargando: boolean = false;

  // VARIABLES PRESIÓN ARTERIAL
  midiendoBP: boolean = false;
  presionSistolica: number | null = null;
  presionDiastolica: number | null = null;
  pulsoBP: number | null = null;
  errorBP: string | null = null;

  // VARIABLES ECG
  midiendoECG: boolean = false;
  errorECG: string | null = null;
  puntosECG: number[] = [];
  private ecgAnimacionActiva: boolean = false;
  ecgHR: number | null = null;
  ecgHRV: number | null = null;
  dedoPuestoECG: boolean = true;

  // Rango de fechas seleccionado para las gráficas de datos guardados
  rangoGraficasSeleccionado: '24h' | '7d' | '30d' | 'todo' = '7d';

  // Instancias de las 9 gráficas de históricos guardados
  public chartTemperatura: any;
  public chartSpo2: any;
  public chartPulsoOxigeno: any;
  public chartSistolica: any;
  public chartDiastolica: any;
  public chartPulsoPresion: any;
  public chartEcgHR: any;
  public chartEcgHRV: any;
  public chartBateria: any;
  public glucosa: any; // TODO - Queda pendiente de analizar

  // Medición activa para poder detenerla
  medicionActiva: 'OX' | 'BP' | 'BG' | 'BT' | 'ECG' | 'BATTERY' | null = null;

  constructor(
    private LTS: LinktopService,
    private cdr: ChangeDetectorRef,
    private historial: HistorialService,
  ) {
    // Registramos los iconos que vamos a usar en las tarjetas (necesario en standalone components)
    addIcons({
      thermometerOutline,
      batteryHalfOutline,
      waterOutline,
      pulseOutline,
      heartOutline,
      //thermometerOutline: thermometerOutline,
      //waterOutline: waterOutline,
      //pulseOutline: pulseOutline,
      //batteryHalfOutline: batteryHalfOutline,
      //heartOutline: heartOutline,
      checkmarkCircle: checkmarkCircle,
      warningOutline: warningOutline,
    });
  }

  async ngOnInit() {
    this.estadoBluetooth = await this.LTS.inicializarBluetooth();

    // Cada vez que se guarda algo nuevo, redibujamos las gráficas automáticamente
    this.historial.datosActualizados$.subscribe(() => {
      this.cargarGraficasDesdeAlmacenamiento();
    });

    // Cargamos las gráficas por primera vez, esté o no conectado el monitor.
    // Esperamos un instante para que Angular renderice el HTML antes de buscar los <canvas>
    setTimeout(() => {
      this.cargarGraficasDesdeAlmacenamiento();
    }, 300);
  }

  async buscarDispositivo() {
    this.estadoBluetooth = 'Buscando el monitor de salud Linktop...';
    const respuesta = await this.LTS.escanearConectar();
    this.estadoBluetooth = respuesta;
    if (!respuesta.includes('Error')) this.conectado = true;
  }

  medirBT() {
    this.estadoBluetooth = 'iniciando medición...';
    this.midiendoBT = true;
    this.temperatura = null;

    this.LTS.medicionTemperatura((resultado) => {
      this.midiendoBT = false;
      this.temperatura = Number(resultado);
      this.estadoBluetooth = 'Medición completada';

      this.historial.guardarMedicion('temperatura', {
        temperatura: this.temperatura,
      });
    });
  }

  medirOX() {
    this.medicionActiva = 'OX';
    this.midiendoOX = true;
    this.midiendoBT = false;
    this.spo2 = null;
    this.pulso = null;
    this.dedoPuesto = true;
    this.errorOxigeno = null;
    this.estadoBluetooth = 'Oxímetro activado. Esperando lectura...';

    let spo2Temp: number | null = null;
    let pulsoTemp: number | null = null;

    this.LTS.medicionOxigeno(
      (resultadoSpO2, resultadoPulso) => {
        spo2Temp = resultadoSpO2;
        pulsoTemp = resultadoPulso;
      },
      (estaTocando) => {
        this.dedoPuesto = estaTocando;
        if (!estaTocando) {
          this.midiendoOX = false;
          spo2Temp = null;
          pulsoTemp = null;
          this.spo2 = null;
          this.pulso = null;
          this.errorOxigeno =
            'Medición interrumpida. Vuelva a intentarlo manteniendo el dedo apoyado.';
          this.estadoBluetooth = '⚠️ ¡Has levantado el dedo del sensor!';
        } else {
          this.estadoBluetooth = 'Midiendo oxígeno... Mantén el dedo apoyado.';
        }
        this.dedoPuesto = estaTocando;
        this.cdr.detectChanges();
      },
      () => {
        this.midiendoOX = false;
        this.spo2 = spo2Temp;
        this.pulso = pulsoTemp;
        this.estadoBluetooth = 'Medición de Oxigeno completada';
        this.cdr.detectChanges();

        if (spo2Temp !== null && pulsoTemp !== null) {
          this.historial.guardarMedicion('oxigeno', {
            spo2: spo2Temp,
            pulso: pulsoTemp,
          });
        }
      },
    );
  }

  consultarBateria() {
    this.LTS.medicionBateria(
      (nivel) => {
        this.bateria = nivel;
        this.cargando = false;
        this.cdr.detectChanges();
        this.historial.guardarMedicion('bateria', { porcentaje: nivel });
      },
      () => {
        this.bateria = 100;
        this.cargando = false;
        this.cdr.detectChanges();
      },
      (cargando) => {
        this.cargando = cargando;
        this.cdr.detectChanges();
      },
    );
  }

  cancelarMedicion() {
    if (this.medicionActiva) this.LTS.cancelarMedicion(this.medicionActiva);
    this.midiendoOX = false;
    this.midiendoBP = false;
    this.midiendoECG = false;
    this.estadoBluetooth = 'Medición cancelada.';
    this.cdr.detectChanges();
  }

  medirBP() {
    this.medicionActiva = 'BP';
    this.midiendoBP = true;
    this.presionSistolica = null;
    this.presionDiastolica = null;
    this.pulsoBP = null;
    this.errorBP = null;
    this.estadoBluetooth = 'Midiendo presión arterial...';

    this.LTS.medicionPresion(
      (sistolica, diastolica, pulso) => {
        this.midiendoBP = false;
        this.presionSistolica = Math.round(sistolica);
        this.presionDiastolica = Math.round(diastolica);
        this.pulsoBP = Math.round(pulso);
        this.estadoBluetooth = 'Medición de presión completada.';
        this.cdr.detectChanges();

        this.historial.guardarMedicion('presion', {
          sistolica: this.presionSistolica,
          diastolica: this.presionDiastolica,
          pulso: this.pulsoBP,
        });
      },
      (mensaje) => {
        this.midiendoBP = false;
        this.errorBP = mensaje;
        this.estadoBluetooth = 'Error en la medición de presión.';
        this.cdr.detectChanges();
      },
      () => {
        this.midiendoBP = false;
        this.estadoBluetooth = 'Medición de presión interrumpida.';
        this.cdr.detectChanges();
      },
    );
  }

  medirECG() {
    this.medicionActiva = 'ECG';
    this.midiendoECG = true;
    this.errorECG = null;
    this.puntosECG = [];
    this.ecgAnimacionActiva = true;
    this.estadoBluetooth =
      'ECG activo. Mantenga los dedos sobre el electrodo...';
    this.ecgHR = null;
    this.ecgHRV = null;
    this.dedoPuestoECG = true;

    this.bucleECG();

    setTimeout(() => {
      const canvas = document.getElementById('canvasECG') as HTMLCanvasElement;
      if (canvas) {
        canvas.width = canvas.offsetWidth;
      }
    }, 100);

    this.LTS.medicionECG(
      (valor, muestra) => {
        this.puntosECG.push(valor);
      },
      () => {
        this.ecgAnimacionActiva = false;
        this.midiendoECG = false;
        this.puntosECG = [];
        this.errorECG =
          'Medición interrumpida. Mantenga los dedos sobre el electrodo durante 30 segundos.';
        this.estadoBluetooth = 'ECG interrumpido.';
        this.cdr.detectChanges();
      },
      () => {
        this.ecgAnimacionActiva = false;
        this.midiendoECG = false;
        this.estadoBluetooth = 'ECG completado.';
        this.cdr.detectChanges();
      },
      (metricas) => {
        this.ecgHR = metricas.hr;
        this.ecgHRV = metricas.hrv;

        this.ecgAnimacionActiva = false;
        this.cancelarMedicion();

        this.historial.guardarMedicion('ecg', {
          hr: metricas.hr,
          hrv: metricas.hrv,
        });
      },
      (tocando) => {
        this.dedoPuestoECG = tocando;
        this.cdr.detectChanges();
      },
    );
  }

  bucleECG() {
    if (!this.ecgAnimacionActiva) return;

    this.dibujarECG();

    setTimeout(() => {
      requestAnimationFrame(() => this.bucleECG());
    }, 33);
  }

  dibujarECG() {
    const canvas = document.getElementById('canvasECG') as HTMLCanvasElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ancho = canvas.width;
    const alto = canvas.height;
    const ventana = this.puntosECG.slice(-1200);

    // Fondo blanco, a juego con las tarjetas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ancho, alto);

    if (ventana.length < 2) return;

    const max = ventana.reduce((a, b) => Math.max(a, b), -Infinity);
    const min = ventana.reduce((a, b) => Math.min(a, b), Infinity);
    const margen = (max - min) * 0.2;
    const rango = max - min + margen * 2 || 1;
    const ecgMin = min - margen;

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

    // Onda ECG en rojo/rosa, color estándar de "corazón" en apps de salud iOS
    ctx.strokeStyle = '#ff2d55';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const pixelesPorPunto = ancho / ventana.length;

    ventana.forEach((punto, i) => {
      const y = alto - ((punto - ecgMin) / rango) * (alto * 0.8) - alto * 0.1;
      const x = i * pixelesPorPunto;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();
  }

  async verHistorialDebug() {
    const historial = await this.historial.obtenerHistorial();
  }

  /**
   * Crea las 9 gráficas de históricos guardados, buscando cada canvas por su ID.
   * Se ejecuta solo la primera vez.
   */
  crearGraficas_historicos() {
    const idsYVariables: [string, string][] = [
      ['graficaTemperatura', 'chartTemperatura'],
      ['graficaSpo2', 'chartSpo2'],
      ['graficaPulsoOxigeno', 'chartPulsoOxigeno'],
      ['graficaSistolica', 'chartSistolica'],
      ['graficaDiastolica', 'chartDiastolica'],
      ['graficaPulsoPresion', 'chartPulsoPresion'],
      ['graficaEcgHR', 'chartEcgHR'],
      ['graficaEcgHRV', 'chartEcgHRV'],
      ['graficaBateria', 'chartBateria'],
    ];

    // Si algún canvas no está todavía en el DOM, abortamos sin crear nada
    const canvases = idsYVariables.map(
      ([id]) => document.getElementById(id) as HTMLCanvasElement,
    );

    if (canvases.some((c) => !c)) return;

    const colores: Record<string, string> = {
      chartTemperatura: 'orange',
      chartSpo2: 'cyan',
      chartPulsoOxigeno: 'red',
      chartSistolica: 'purple',
      chartDiastolica: 'blue',
      chartPulsoPresion: 'red',
      chartEcgHR: 'red',
      chartEcgHRV: 'green',
      chartBateria: 'green',
    };

    idsYVariables.forEach(([id, variable], i) => {
      (this as any)[variable] = new Chart(canvases[i], {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: variable,
              data: [],
              borderColor: colores[variable],
              tension: 0.4,
            },
          ],
        },
        options: { responsive: true },
      });
    });
  }

  /**
   * Calcula la fecha de inicio según la opción elegida en el selector de rango.
   */
  private calcularFechaDesde(): Date {
    const ahora = new Date();
    switch (this.rangoGraficasSeleccionado) {
      case '24h':
        return new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
      case '7d':
        return new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000);
      case 'todo':
      default:
        return new Date(0);
    }
  }

  /**
   * Lee del almacenamiento local las 9 métricas guardadas, filtradas por el
   * rango de fechas seleccionado, y redibuja las gráficas desde cero.
   * No depende de que el monitor esté conectado -- lee siempre de lo guardado.
   */
  async cargarGraficasDesdeAlmacenamiento() {
    if (!this.chartTemperatura) {
      this.crearGraficas_historicos();
    }
    if (!this.chartTemperatura) return; // Los canvas aún no están en el DOM

    const desde = this.calcularFechaDesde();

    const [temperatura, oxigeno, presion, ecg, bateria] = await Promise.all([
      this.historial.obtenerHistorialPorTipoYFecha('temperatura', desde),
      this.historial.obtenerHistorialPorTipoYFecha('oxigeno', desde),
      this.historial.obtenerHistorialPorTipoYFecha('presion', desde),
      this.historial.obtenerHistorialPorTipoYFecha('ecg', desde),
      this.historial.obtenerHistorialPorTipoYFecha('bateria', desde),
    ]);

    const ordenarPorFecha = (lista: any[]) =>
      lista.sort(
        (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime(),
      );
    [temperatura, oxigeno, presion, ecg, bateria].forEach(ordenarPorFecha);

    const formatearFecha = (fechaISO: string) => {
      const f = new Date(fechaISO);
      const dia = f.getDate().toString().padStart(2, '0');
      const mes = (f.getMonth() + 1).toString().padStart(2, '0');
      const horas = f.getHours().toString().padStart(2, '0');
      const mins = f.getMinutes().toString().padStart(2, '0');
      return `${dia}/${mes} ${horas}:${mins}`;
    };

    const volcarEnGrafica = (chart: any, lista: any[], campo: string) => {
      chart.data.labels = lista.map((r) => formatearFecha(r.fecha));
      chart.data.datasets[0].data = lista.map((r) => r.valores[campo]);
      chart.update();
    };

    volcarEnGrafica(this.chartTemperatura, temperatura, 'temperatura');
    volcarEnGrafica(this.chartSpo2, oxigeno, 'spo2');
    volcarEnGrafica(this.chartPulsoOxigeno, oxigeno, 'pulso');
    volcarEnGrafica(this.chartSistolica, presion, 'sistolica');
    volcarEnGrafica(this.chartDiastolica, presion, 'diastolica');
    volcarEnGrafica(this.chartPulsoPresion, presion, 'pulso');
    volcarEnGrafica(this.chartEcgHR, ecg, 'hr');
    volcarEnGrafica(this.chartEcgHRV, ecg, 'hrv');
    volcarEnGrafica(this.chartBateria, bateria, 'porcentaje');

    this.cdr.detectChanges();
  }

  /** Se llama cuando el usuario cambia el selector de rango de fechas. */
  async cambiarRangoGraficas() {
    await this.cargarGraficasDesdeAlmacenamiento();
  }
}
