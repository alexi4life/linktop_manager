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
import { LinktopService } from '../services/linktop';
import { CommonModule } from '@angular/common';
import { HistorialService } from '../services/historial.service';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
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
    this.LTS.cancelarMedicion();
    this.midiendoOX = false;
    this.midiendoBP = false;
    this.midiendoECG = false;
    this.estadoBluetooth = 'Medición cancelada.';
    this.cdr.detectChanges();
  }

  medirBP() {
    this.midiendoBP = true;
    this.presionSistolica = null;
    this.presionDiastolica = null;
    this.pulsoBP = null;
    this.errorBP = null;
    this.estadoBluetooth = 'Midiendo presión arterial...';

    this.LTS.medicionPresion(
      (sistolica, diastolica, pulso) => {
        this.midiendoBP = false;
        this.presionSistolica = sistolica;
        this.presionDiastolica = diastolica;
        this.pulsoBP = pulso;
        this.estadoBluetooth = 'Medición de presión completada.';
        this.cdr.detectChanges();
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
    console.log('[HISTORIAL COMPLETO]', historial);
  }
}
