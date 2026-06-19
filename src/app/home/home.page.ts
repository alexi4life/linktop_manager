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
} from '@ionic/angular/standalone';
import { LinktopService } from '../services/linktop';
import { CommonModule } from '@angular/common';

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
    CommonModule,
  ],
})
export class HomePage implements OnInit {
  /* VARIABLES DEL BLUETOOTH*/
  estadoBluetooth: string = 'Bluetooth apagado';
  conectado: boolean = false;

  /* VARIABLES TEMPERATURA */
  midiendoBT: boolean = false;
  temperatura: number | null = null;

  /* VARIABLES DEL SENSOR DE OXÍGENO */
  midiendoOX: boolean = false;
  spo2: number | null = null;
  pulso: number | null = null;
  dedoPuesto: boolean = true;
  errorOxigeno: string | null = null;

  /* VARIABLES BATERÍA */
  bateria: number | null = null;
  cargando: boolean = false;

  /* VARIABLES PRESIÓN ARTERIAL */
  midiendoBP: boolean = false;
  presionSistolica: number | null = null;
  presionDiastolica: number | null = null;
  pulsoBP: number | null = null;
  errorBP: string | null = null;

  constructor(
    private LTS: LinktopService,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit() {
    // Llamamos a la inicialización del servicio y guardamos su respuesta
    this.estadoBluetooth = await this.LTS.inicializarBluetooth();
  }

  /* BUSQUEDA DEL DISPOSITIVO */
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
      // Cuando el SDK tenga el dato lo pinta aqui
      this.midiendoBT = false;
      this.temperatura = Number(resultado);
      this.estadoBluetooth = 'Medición completada';
    });
  }

  /* MEDIR OXÍGENO Y PULSO */
  medirOX() {
    // TODO  - ESTO NO FUNCIONA
    // TODO - Se pueden dar las variables de pulso y oxigeno por separado=?
    this.midiendoOX = true;
    this.midiendoBT = false; // Aseguramos que el otro panel no interfiera
    this.spo2 = null;
    this.pulso = null;
    this.dedoPuesto = true; // Reseteamos el estado del dedo
    this.errorOxigeno = null;
    this.estadoBluetooth = 'Oxímetro activado. Esperando lectura...';
    // Variables temporales
    let spo2Temp: number | null = null;
    let pulsoTemp: number | null = null;

    // Llamamos al nuevo método de tu servicio
    this.LTS.medicionOxigeno(
      // Callback 1: Resultado Final
      (resultadoSpO2, resultadoPulso) => {
        //this.midiendoOX = false;
        spo2Temp = resultadoSpO2;
        pulsoTemp = resultadoPulso;
        //this.estadoBluetooth = 'Medición de oxígeno completada.';
      },
      // Callback Cambios en el dedo
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
          console.log(this.estadoBluetooth, this.errorOxigeno);
        } else {
          this.estadoBluetooth = 'Midiendo oxígeno... Mantén el dedo apoyado.';
        }
        this.dedoPuesto = estaTocando;
        this.cdr.detectChanges(); //
      },
      // Callback 3: Fin de la medicion
      () => {
        this.midiendoOX = false;
        this.spo2 = spo2Temp;
        this.pulso = pulsoTemp;
        this.estadoBluetooth = 'Medición de Oxigeno completada';
        console.log('[OX] onEnd ejecutado, midiendo OX: ', this.midiendoOX);
        this.cdr.detectChanges();
      },
    );
  }
  /* CONSULTAR BATERÍA */
  consultarBateria() {
    this.LTS.medicionBateria(
      // Nivel de batería
      (nivel) => {
        this.bateria = nivel;
        this.cargando = false;
        this.cdr.detectChanges();
      },
      // Carga completa
      () => {
        this.bateria = 100;
        this.cargando = false;
        this.cdr.detectChanges();
      },
      // Estado de carga
      (cargando) => {
        this.cargando = cargando;
        this.cdr.detectChanges();
      },
    );
  }

  /* CANCELAR MEDICIÓN EN CURSO */
  cancelarMedicion() {
    this.LTS.cancelarMedicion();
    // Apagamos todos los spinners
    this.midiendoOX = false;
    this.midiendoBP = false;
    this.estadoBluetooth = 'Medición cancelada.';
    this.cdr.detectChanges();
  }

  /* MEDIR PRESIÓN ARTERIAL */
  medirBP() {
    this.midiendoBP = true;
    this.presionSistolica = null;
    this.presionDiastolica = null;
    this.pulsoBP = null;
    this.errorBP = null;
    this.estadoBluetooth = 'Midiendo presión arterial...';

    this.LTS.medicionPresion(
      // Resultado final
      (sistolica, diastolica, pulso) => {
        this.midiendoBP = false;
        this.presionSistolica = sistolica;
        this.presionDiastolica = diastolica;
        this.pulsoBP = pulso;
        this.estadoBluetooth = 'Medición de presión completada.';
        this.cdr.detectChanges();
      },
      // Error durante la medición
      (mensaje) => {
        this.midiendoBP = false;
        this.errorBP = mensaje;
        this.estadoBluetooth = 'Error en la medición de presión.';
        this.cdr.detectChanges();
      },
      // Fin sin resultado
      () => {
        this.midiendoBP = false;
        this.estadoBluetooth = 'Medición de presión interrumpida.';
        this.cdr.detectChanges();
      },
    );
  }
}
