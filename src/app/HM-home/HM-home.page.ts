import {
  Component,
  OnInit,
  ChangeDetectorRef,
  DestroyRef,
  ElementRef,
  ViewChild,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  thermometerOutline,
  waterOutline,
  pulseOutline,
  batteryHalfOutline,
  heartOutline,
  checkmarkCircle,
  warningOutline,
} from 'ionicons/icons';
import { HealthMonitorService } from '../services/HM-health-monitor';
import { CommonModule } from '@angular/common';
import { HistorialService } from '../services/HM-historial.service';
import { GraficaHistoricoComponent } from '../components/grafica-historico/grafica-historico.component';
import { SegmentoIosComponent } from '../components/segmento-ios/segmento-ios.component';
import { DECIMALES, NumeroPipe } from '../constants/formato';
import { IndicadorMedicionComponent } from '../components/indicador-medicion/indicador-medicion.component';
import {
  EstadoConexion,
  EstadoConexionComponent,
} from '../components/estado-conexion/estado-conexion.component';
import {
  COLORES_METRICA,
  DefinicionGrafica,
  OPCIONES_RANGO,
  PuntoGrafica,
  RangoGrafica,
  aPuntos,
  calcularFechaDesde,
} from '../constants/graficas';

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
    IonIcon,
    CommonModule,
    GraficaHistoricoComponent,
    SegmentoIosComponent,
    EstadoConexionComponent,
    IndicadorMedicionComponent,
    NumeroPipe,
  ],
})
export class HomePage implements OnInit {
  // VARIABLES DEL BLUETOOTH
  estadoConexion: EstadoConexion = 'sin-conectar';
  nombreDispositivo: string = '';
  conectado: boolean = false;

  // SECCIÓN VISIBLE (segmento de la cabecera)
  seccion: 'medidas' | 'historicos' = 'medidas';
  readonly secciones = [
    { valor: 'medidas', texto: 'Medidas' },
    { valor: 'historicos', texto: 'Históricos' },
  ];

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
  private lienzoECG?: HTMLCanvasElement;
  ecgHR: number | null = null;
  ecgHRV: number | null = null;
  dedoPuestoECG: boolean = true;

  // VARIABLES DE GRÁFICAS DE HISTÓRICOS
  rangoGraficasSeleccionado: RangoGrafica = '7d';
  readonly opcionesRango = OPCIONES_RANGO;

  // Gráficas que se muestran, en orden; sus puntos se guardan en "puntosGraficas"
  readonly graficas: DefinicionGrafica[] = [
    {
      clave: 'temperatura',
      titulo: 'Temperatura',
      unidad: '°C',
      color: COLORES_METRICA.temperatura,
      decimales: DECIMALES.temperatura,
    },
    {
      clave: 'spo2',
      titulo: 'SpO2',
      unidad: '%',
      color: COLORES_METRICA.spo2,
    },
    {
      clave: 'pulsoOxigeno',
      titulo: 'Pulso (oxímetro)',
      unidad: 'lpm',
      color: COLORES_METRICA.pulso,
    },
    {
      clave: 'sistolica',
      titulo: 'Presión sistólica',
      unidad: 'mmHg',
      color: COLORES_METRICA.sistolica,
    },
    {
      clave: 'diastolica',
      titulo: 'Presión diastólica',
      unidad: 'mmHg',
      color: COLORES_METRICA.diastolica,
    },
    {
      clave: 'pulsoPresion',
      titulo: 'Pulso (tensiómetro)',
      unidad: 'lpm',
      color: COLORES_METRICA.pulso,
    },
    {
      clave: 'ecgHR',
      titulo: 'ECG · Frecuencia cardíaca',
      unidad: 'lpm',
      color: COLORES_METRICA.pulso,
    },
    {
      clave: 'ecgHRV',
      titulo: 'ECG · HRV',
      unidad: 'ms',
      color: COLORES_METRICA.hrv,
    },
    {
      clave: 'bateria',
      titulo: 'Batería',
      unidad: '%',
      color: COLORES_METRICA.bateria,
    },
  ];
  puntosGraficas: Partial<Record<string, PuntoGrafica[]>> = {};

  // Medición activa para poder detenerla
  medicionActiva: 'OX' | 'BP' | 'BG' | 'BT' | 'ECG' | 'BATTERY' | null = null;

  // Para cerrar las suscripciones automáticamente si la página se destruye
  private destroyRef = inject(DestroyRef);

  /** Angular lo llama al crear o eliminar el canvas del ECG (está dentro de un *ngIf). */
  @ViewChild('canvasECG') set canvasECG(
    ref: ElementRef<HTMLCanvasElement> | undefined,
  ) {
    this.lienzoECG = ref?.nativeElement;
    // Resolución interna igual al ancho real, para que la onda no se deforme
    if (this.lienzoECG) this.lienzoECG.width = this.lienzoECG.offsetWidth;
  }

  constructor(
    private LTS: HealthMonitorService,
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
      checkmarkCircle,
      warningOutline,
    });
  }

  /**
   * Inicializa el Bluetooth, carga las gráficas guardadas y se suscribe a los
   * nuevos guardados del historial para redibujarlas automáticamente.
   */
  async ngOnInit() {
    const respuesta = await this.LTS.inicializarBluetooth();
    if (respuesta.includes('Error')) this.estadoConexion = 'error';

    // Cada vez que se guarda algo nuevo, redibujamos las gráficas automáticamente.
    // Si llegan varios guardados seguidos, se agrupan en una sola recarga
    this.historial.datosActualizados$
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.cargarGraficasDesdeAlmacenamiento());

    // Cargamos las gráficas por primera vez, esté o no conectado el monitor
    this.cargarGraficasDesdeAlmacenamiento();
  }

  /** Busca el Health Monitor cercano y se conecta a él. */
  async buscarDispositivo() {
    this.estadoConexion = 'buscando';
    const respuesta = await this.LTS.escanearConectar();
    this.conectado = !respuesta.includes('Error');

    // Si el usuario cancela el escaneo, volvemos a "sin conectar"
    this.estadoConexion = this.conectado ? 'conectado' : 'sin-conectar';
    this.nombreDispositivo = this.LTS.nombreDispositivo;
  }

  /** Indica si hay alguna medición en curso, para bloquear el resto de botones. */
  get hayMedicionEnCurso(): boolean {
    return (
      this.midiendoBT || this.midiendoOX || this.midiendoBP || this.midiendoECG
    );
  }

  /** Mide la temperatura corporal y la guarda en el historial. */
  medirBT() {
    this.midiendoBT = true;
    this.temperatura = null;

    this.LTS.medicionTemperatura((resultado) => {
      this.midiendoBT = false;
      this.temperatura = Number(resultado);

      this.historial.guardarMedicion('temperatura', {
        temperatura: this.temperatura,
      });
    });
  }

  /**
   * Mide oxígeno en sangre (SpO2) y pulso. Si no hay dedo, avisa y sigue
   * esperando; al terminar, guarda el último valor recibido con el dedo puesto.
   */
  medirOX() {
    this.medicionActiva = 'OX';
    this.midiendoOX = true;
    this.midiendoBT = false;
    this.spo2 = null;
    this.pulso = null;
    this.dedoPuesto = false; // Hasta que el sensor detecte el dedo
    this.errorOxigeno = null;

    let spo2Temp: number | null = null;
    let pulsoTemp: number | null = null;

    this.LTS.medicionOxigeno(
      (resultadoSpO2, resultadoPulso) => {
        spo2Temp = resultadoSpO2;
        pulsoTemp = resultadoPulso;
        // Si llegan lecturas es que hay dedo, aunque el SDK no lo haya avisado
        if (!this.dedoPuesto) {
          this.dedoPuesto = true;
          this.cdr.detectChanges();
        }
      },
      // Sin dedo: solo avisamos; la medición sigue hasta que lo apoye
      (tocando) => {
        this.dedoPuesto = tocando;
        if (!tocando) {
          // Las lecturas sin dedo no valen: esperamos a las siguientes
          spo2Temp = null;
          pulsoTemp = null;
        }
        this.cdr.detectChanges();
      },
      // Fin correcto tras el tiempo mínimo: mostramos y guardamos
      () => {
        this.midiendoOX = false;
        this.spo2 = spo2Temp;
        this.pulso = pulsoTemp;
        this.cdr.detectChanges();

        if (spo2Temp !== null && pulsoTemp !== null) {
          this.historial.guardarMedicion('oxigeno', {
            spo2: spo2Temp,
            pulso: pulsoTemp,
          });
        }
      },
      // El monitor terminó antes de tiempo: no hay resultado válido
      () => {
        this.midiendoOX = false;
        this.errorOxigeno =
          'Medición interrumpida. Vuelva a intentarlo manteniendo el dedo apoyado.';
        this.cdr.detectChanges();
      },
    );
  }

  /** Consulta el nivel de batería del monitor y si está cargando. */
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

  /** Detiene la medición activa (oxígeno, presión o ECG) en el monitor. */
  cancelarMedicion() {
    if (this.medicionActiva) this.LTS.cancelarMedicion(this.medicionActiva);
    this.midiendoOX = false;
    this.midiendoBP = false;
    this.midiendoECG = false;
    this.cdr.detectChanges();
  }

  /** Mide la presión arterial (sistólica, diastólica y pulso). */
  medirBP() {
    this.medicionActiva = 'BP';
    this.midiendoBP = true;
    this.presionSistolica = null;
    this.presionDiastolica = null;
    this.pulsoBP = null;
    this.errorBP = null;

    this.LTS.medicionPresion(
      (sistolica, diastolica, pulso) => {
        this.midiendoBP = false;
        this.presionSistolica = Math.round(sistolica);
        this.presionDiastolica = Math.round(diastolica);
        this.pulsoBP = Math.round(pulso);
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
        this.cdr.detectChanges();
      },
      () => {
        this.midiendoBP = false;
        this.cdr.detectChanges();
      },
    );
  }

  /**
   * Inicia el electrocardiograma: dibuja la onda en tiempo real y, al recibir
   * la frecuencia cardíaca y la HRV calculadas por el SDK, la detiene y las guarda.
   */
  medirECG() {
    this.medicionActiva = 'ECG';
    this.midiendoECG = true;
    this.errorECG = null;
    this.puntosECG = [];
    this.ecgAnimacionActiva = true;
    this.ecgHR = null;
    this.ecgHRV = null;
    this.dedoPuestoECG = false; // Hasta que el sensor detecte los dedos

    this.bucleECG();

    this.LTS.medicionECG(
      (valor) => {
        this.puntosECG.push(valor);
      },
      () => {
        this.ecgAnimacionActiva = false;
        this.midiendoECG = false;
        this.puntosECG = [];
        this.errorECG =
          'Medición interrumpida. Mantenga los dedos sobre el electrodo durante 30 segundos.';
        this.cdr.detectChanges();
      },
      () => {
        this.ecgAnimacionActiva = false;
        this.midiendoECG = false;
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

  /** Redibuja la onda del ECG a unos 30 fotogramas por segundo mientras está activo. */
  bucleECG() {
    if (!this.ecgAnimacionActiva) return;

    this.dibujarECG();

    setTimeout(() => {
      requestAnimationFrame(() => this.bucleECG());
    }, 33);
  }

  /** Pinta en el canvas los últimos 1200 puntos de la onda del ECG, autoescalados. */
  dibujarECG() {
    const canvas = this.lienzoECG;
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

  /**
   * Lee del almacenamiento local las métricas guardadas dentro del rango de
   * fechas elegido y actualiza los puntos de cada gráfica.
   * No depende de que el monitor esté conectado: lee siempre de lo guardado.
   */
  async cargarGraficasDesdeAlmacenamiento() {
    const desde = calcularFechaDesde(this.rangoGraficasSeleccionado);

    // Una sola lectura del almacén para todas las gráficas
    const {
      temperatura = [],
      oxigeno = [],
      presion = [],
      ecg = [],
      bateria = [],
    } = await this.historial.obtenerAgrupadoPorTipo(desde);

    // Las claves coinciden con las de "graficas"
    this.puntosGraficas = {
      temperatura: aPuntos(temperatura, 'temperatura'),
      spo2: aPuntos(oxigeno, 'spo2'),
      pulsoOxigeno: aPuntos(oxigeno, 'pulso'),
      sistolica: aPuntos(presion, 'sistolica'),
      diastolica: aPuntos(presion, 'diastolica'),
      pulsoPresion: aPuntos(presion, 'pulso'),
      ecgHR: aPuntos(ecg, 'hr'),
      ecgHRV: aPuntos(ecg, 'hrv'),
      bateria: aPuntos(bateria, 'porcentaje'),
    };

    this.cdr.detectChanges();
  }

  /** Se llama cuando el usuario cambia el selector de rango de fechas. */
  async cambiarRangoGraficas(rango: RangoGrafica) {
    this.rangoGraficasSeleccionado = rango;
    await this.cargarGraficasDesdeAlmacenamiento();
  }
}
