import {
  Component,
  OnInit,
  ChangeDetectorRef,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, debounceTime } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HistorialAnilloService } from '../services/ring-historial.service';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButton,
  IonIcon,
  IonToggle,
  IonSelect,
  IonSelectOption,
  ToastController,
} from '@ionic/angular/standalone';
import { RingBluetooth } from '../services/ring-bluetooth';
import { timemgt } from '../constants/aux-funct';
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
import { addIcons } from 'ionicons';
import {
  heartOutline,
  waterOutline,
  thermometerOutline,
  batteryHalfOutline,
  walkOutline,
  bicycleOutline,
  moonOutline,
  pulseOutline,
  informationCircleOutline,
} from 'ionicons/icons';

/**
 * Tiempo máximo que se muestra "Midiendo…" sin recibir respuesta del anillo.
 * El SDK no avisa si el anillo deja de responder, así que hace falta un límite.
 */
const TIEMPO_MAXIMO_MEDICION_MS = 60_000;

@Component({
  selector: 'app-ring-home',
  templateUrl: './ring-home.page.html',
  styleUrls: ['./ring-home.page.scss'],
  standalone: true,
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButton,
    IonIcon,
    IonSelect,
    IonToggle,
    IonSelectOption,
    CommonModule,
    FormsModule,
    GraficaHistoricoComponent,
    SegmentoIosComponent,
    EstadoConexionComponent,
    IndicadorMedicionComponent,
    NumeroPipe,
  ],
})
export class RingHomePage implements OnInit {
  // SECCIÓN VISIBLE (segmento de la cabecera)
  seccion: 'medidas' | 'historicos' | 'dispositivo' = 'medidas';
  readonly secciones = [
    { valor: 'medidas', texto: 'Medidas' },
    { valor: 'historicos', texto: 'Históricos' },
    { valor: 'dispositivo', texto: 'Dispositivo' },
  ];

  // VARIABLES DE CONEXIÓN
  ringName: string = ''; // Nombre del anillo una vez conectado
  ringID: string = ''; // ID Bluetooth del anillo
  connected: boolean = false; // Si está conectado en este momento
  hasRing: boolean = false; // Si ya tenemos un anillo vinculado guardado
  buscando: boolean = false; // Si hay un escaneo/conexión manual en curso

  // VARIABLES DE MEDICIÓN EN VIVO
  pulso: number | string = '---';
  oxigeno: number | string = '--';
  hrv: number | string = '--'; // Variabilidad de la frecuencia cardíaca
  bateria: number | string = '---'; // Porcentaje de batería
  estadobateria: string = '--'; // Si está cargando o no
  temperatura: number | string = '--';

  // Medición puntual en curso (para mostrar "Midiendo…") y error de la última
  midiendo: 'pulso' | 'oxigeno' | 'temperatura' | null = null;
  errorMedicion: string | null = null;
  private temporizadorMedicion: any;

  // ELECTROCARDIOGRAMA (calculado por el anillo)

  // VARIABLES DE INFORMACIÓN DEL DISPOSITIVO
  bleAddress: string = '--';
  deviceVer: string = '';
  sn: string = '--'; // Número de serie
  bindStatus: string = '--'; // Si está vinculado o no
  hrMeasurementTime: number | string = '--'; // Tiempo de medición de pulso, en segundos
  oxMeasurementInterval: number | string = '--'; // Intervalo de medición de oxígeno, en minutos
  oxMeasurementSwitch: string = '--'; // Si el oxígeno automático está encendido o no
  oxAutomaticoActivo: boolean = false;
  private oxAutomaticoEnAnillo = false; // Último estado conocido en el anillo, para no reenviarlo

  // VARIABLES DE DATOS HISTÓRICOS
  registerNum: number = 0; // Número de registros históricos disponibles
  medicalHist: any[] = []; // Array con todos los registros históricos válidos

  // VARIABLES DE SUEÑO
  deepSleepTime: number | string = '--';
  lightSleepTime: number | string = '--';
  REMsleepTime: number | string = '--';
  wakeTime: number | string = '--';
  sleepStartTime: number | string = '--';
  sleepEndTime: number | string = '--';

  // VARIABLES DE PULSO EN REPOSO
  restingHeartRate: number | string = '--';

  // Métricas nocturnas más recientes (TODO: comprobar con datos reales de una noche)
  oxigenoNocturno: number | string = '--';
  respiracion: number | string = '--';
  inmersion: number | string = '--';

  // VARIABLES DE MODO DEPORTE
  isSportMode: boolean = false;
  sportTimeoutId: any; // Temporizador para el apagado automático del modo deporte

  // VARIABLES PARA EL CÁLCULO DE CALORÍAS
  userHeight: number = 180; // Altura del usuario en cm
  exerciseIntensity: number = 0.05; // Intensidad del ejercicio (baja/media/alta)

  // VARIABLES DE ACTIVIDAD FÍSICA
  calories: number | string = '--';
  steps: number | string = '--';

  //VARIABLES CONFIGURACIÓN
  intervaloOxigenoSeleccionado: number = 15; // Minutos entre mediciones automáticas de oxígeno (0:00-6:00)

  // VARIABLES DE GRÁFICAS DE HISTÓRICOS
  rangoGraficasSeleccionado: RangoGrafica = '7d';
  readonly opcionesRango = OPCIONES_RANGO;

  // Gráficas que se muestran, en orden; sus puntos se guardan en "puntosGraficas"
  readonly graficas: DefinicionGrafica[] = [
    {
      clave: 'pulso',
      titulo: 'Pulso',
      unidad: 'lpm',
      color: COLORES_METRICA.pulso,
    },
    {
      clave: 'hrv',
      titulo: 'HRV',
      unidad: 'ms',
      color: COLORES_METRICA.hrv,
    },
    {
      clave: 'spo2',
      titulo: 'SpO2',
      unidad: '%',
      color: COLORES_METRICA.spo2,
    },
    {
      clave: 'temperatura',
      titulo: 'Temperatura',
      unidad: '°C',
      color: COLORES_METRICA.temperatura,
      decimales: DECIMALES.temperatura,
    },
    {
      clave: 'pasos',
      titulo: 'Pasos',
      unidad: 'pasos',
      color: COLORES_METRICA.pasos,
      tipo: 'bar',
    },
    {
      clave: 'movimiento',
      titulo: 'Movimiento',
      unidad: '',
      color: COLORES_METRICA.movimiento,
      tipo: 'bar',
    },
    {
      clave: 'bateria',
      titulo: 'Batería',
      unidad: '%',
      color: COLORES_METRICA.bateria,
    },
    {
      clave: 'reposo',
      titulo: 'Pulso en reposo',
      unidad: 'lpm',
      color: COLORES_METRICA.pulso,
      tipo: 'bar',
    },
    {
      clave: 'oxigenoNocturno',
      titulo: 'SpO2 nocturna',
      unidad: '%',
      color: COLORES_METRICA.spo2,
    },
    {
      clave: 'respiracion',
      titulo: 'Frecuencia respiratoria',
      unidad: 'rpm',
      color: COLORES_METRICA.respiracion,
    },
    {
      clave: 'inmersion',
      titulo: 'Inmersión del pulso',
      unidad: '%',
      color: COLORES_METRICA.inmersion,
      decimales: 1,
    },
  ];
  puntosGraficas: Partial<Record<string, PuntoGrafica[]>> = {};

  //Tipo de medición para no falsear datos guardados
  modoMedicionActual: 'oxigeno' | 'hrv' | null = null;

  // Array temporal para guardado de registros históricos
  bufferHistoricoParaGuardar: {
    tipo:
      | 'pulso'
      | 'hrv'
      | 'oxigeno'
      | 'temperatura'
      | 'pasos'
      | 'bateria'
      | 'movimiento';
    valores: Record<string, number>;
    fecha: string;
  }[] = [];

  constructor(
    private ringBLEservice: RingBluetooth,
    private historialAnilloService: HistorialAnilloService,
    private cdr: ChangeDetectorRef,
  ) {
    addIcons({
      heartOutline,
      waterOutline,
      thermometerOutline,
      batteryHalfOutline,
      walkOutline,
      bicycleOutline,
      moonOutline,
      pulseOutline,
      informationCircleOutline,
    });
  }

  // Para cerrar las suscripciones automáticamente si la página se destruye
  private destroyRef = inject(DestroyRef);
  private toastCtrl = inject(ToastController);

  /** Muestra un aviso breve estilo iOS, en lugar de la ventana nativa del navegador. */
  private async avisar(mensaje: string) {
    const toast = await this.toastCtrl.create({
      message: mensaje,
      duration: 2500,
      position: 'top',
      mode: 'ios',
    });
    await toast.present();
  }

  /**
   * Se suscribe a un canal y se da de baja sola al destruirse la página, para
   * que una página recreada no procese (ni guarde) cada dato dos veces.
   */
  private escuchar<T>(canal$: Observable<T>, accion: (dato: T) => void) {
    canal$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(accion);
  }

  /** Estado que se muestra en la tarjeta de conexión. */
  get estadoConexion(): EstadoConexion {
    if (this.connected) return 'conectado';
    if (this.buscando) return 'buscando';
    return this.hasRing ? 'reposo' : 'sin-conectar';
  }

  /**
   * Ciclo de vida de inicialización del componente.
   * Intenta reconectar automáticamente si hay un anillo vinculado guardado en local,
   * y se suscribe a todos los canales (Subject/BehaviorSubject) del servicio Bluetooth
   * para reflejar los datos en la interfaz en cuanto lleguen.
   */
  async ngOnInit() {
    // Comprobamos si ya teníamos un anillo vinculado de una sesión anterior
    const savedID = localStorage.getItem('anillo_vinculado');
    if (savedID) {
      this.ringID = savedID;
      this.hasRing = true;

      // Reconectamos sin pasar por el escaneo manual
      const conectadoOk = await this.ringBLEservice.connectSilently(savedID);
      if (conectadoOk) {
        await this.ringBLEservice.timesynchro();
        await this.ringBLEservice.receiveData();
        console.log('Se ha reconectado con el anillo');
        this.iniciarDescargaHistoricosAutomatica();
      } else {
        console.warn('No se ha podido reconectar con el anillo vinculado');
      }
    }

    // Suscripción al estado de conexión (se actualiza solo/desconecta cada ~30s)
    this.escuchar(this.ringBLEservice.connection_state$, (estado) => {
      console.log(
        '[CONEXIÓN]',
        estado ? 'CONECTADO' : 'DESCONECTADO',
        new Date().toLocaleTimeString(),
      );

      this.connected = estado;
      this.cdr.detectChanges();
    });

    this.escuchar(this.ringBLEservice.comandoConfirmado$, (data) => {
      console.log(
        '[HOME] Comando',
        data.cmd,
        data.result === 'success' ? '✅ ACEPTADO' : '❌ RECHAZADO',
        '- razón:',
        data.reason,
      );
    });

    // Suscripción a la información 1 del dispositivo (dirección BLE, versión...)
    this.escuchar(this.ringBLEservice.deviceInfo1$, (data: any) => {
      this.bleAddress = data.bleAddress;
      this.deviceVer = data.deviceVer;
      this.cdr.detectChanges();
    });

    // Suscripción a la información 2 del dispositivo (número de serie, vinculación...)
    this.escuchar(this.ringBLEservice.deviceInfo2$, (data: any) => {
      this.sn = data.sn;
      this.bindStatus = data.bindStatus;
      this.cdr.detectChanges();
    });

    // Suscripción a la información 5 del dispositivo (pulso y oxígeno automático)
    this.escuchar(this.ringBLEservice.deviceInfo5$, (data: any) => {
      this.hrMeasurementTime = data.hrMeasurementTime;
      this.oxMeasurementInterval = data.oxMeasurementInterval;
      this.oxMeasurementSwitch =
        data.oxMeasurementSwitch === 1 ? 'Encendido' : 'Apagado';

      // El interruptor y el intervalo reflejan lo que tiene configurado el anillo
      this.oxAutomaticoEnAnillo = data.oxMeasurementSwitch === 1;
      this.oxAutomaticoActivo = this.oxAutomaticoEnAnillo;
      if (data.oxMeasurementInterval >= 5) {
        this.intervaloOxigenoSeleccionado = data.oxMeasurementInterval;
      }
      this.cdr.detectChanges();
    });

    // Suscripción a los datos de salud en vivo (pulso, oxígeno, HRV)
    this.escuchar(this.ringBLEservice.healthData$, (data: any) => {
      this.finalizarMedicion();
      this.pulso = data.heartValue;
      this.oxigeno = data.oxValue;
      this.hrv = data.hrvValue;
      this.cdr.detectChanges();

      const registrosAGuardar: {
        tipo: 'pulso' | 'oxigeno' | 'hrv';
        valores: Record<string, number>;
      }[] = [{ tipo: 'pulso', valores: { bpm: data.heartValue } }];

      // Hay que distinguir el registro a guardar (en modo SPO2 o modo HRV)
      if (this.modoMedicionActual === 'oxigeno') {
        registrosAGuardar.push({
          tipo: 'oxigeno',
          valores: { spo2: data.oxValue },
        });
      } else if (this.modoMedicionActual === 'hrv') {
        registrosAGuardar.push({ tipo: 'hrv', valores: { ms: data.hrvValue } });
      }

      this.historialAnilloService.guardarMedicionesEnLote(registrosAGuardar);
    });

    // El anillo no consiguió una lectura estable tras varios intentos
    this.escuchar(this.ringBLEservice.healthDataFallida$, () => {
      this.finalizarMedicion(
        'No se obtuvo una lectura estable. Mantén el anillo quieto e inténtalo de nuevo.',
      );
    });

    // Suscripción al estado de la batería
    this.escuchar(this.ringBLEservice.batteryData$, (data: any) => {
      this.bateria = data.batteryPer;
      this.estadobateria = data.status === 1 ? 'Cargando' : 'Desenchufado';
      this.cdr.detectChanges();

      // Guardado de datos
      this.historialAnilloService.guardarMedicion('bateria', {
        porcentaje: data.batteryPer,
        cargando: data.status,
      });
    });

    // Suscripción a la temperatura del dedo
    this.escuchar(this.ringBLEservice.temperatureData$, (data: any) => {
      this.finalizarMedicion();
      this.temperatura = data;
      this.cdr.detectChanges();

      //Guardado de datos
      // El SDK la entrega como texto ("36.5"): se guarda como número
      this.historialAnilloService.guardarMedicion('temperatura', {
        grados: Number(data),
      });
    });

    // Suscripción al número total de registros históricos disponibles.
    // En cuanto llega, lanzamos automáticamente la descarga de esos históricos.
    this.escuchar(this.ringBLEservice.historicalNum$, (data: any) => {
      if (data.num && data.num > 0) {
        this.registerNum = data.num;
        this.startMeasuring('historicalData', this.registerNum);
      } else {
        console.log('No hay registros');
        this.registerNum = data.num;
      }
      this.cdr.detectChanges();
    });

    this.escuchar(this.ringBLEservice.historicalData$, (data: any) => {
      // El filtro de validez (dedo puesto, sin cargar, pulso razonable) y el
      // descarte de duplicados ya se hacen en el propio servicio (ring-bluetooth.ts)
      this.medicalHist.push(data);
      this.cdr.detectChanges();

      const fechaISO = new Date(data.timeStamp).toISOString();
      this.bufferHistoricoParaGuardar.push(
        { tipo: 'pulso', valores: { bpm: data.heartRate }, fecha: fechaISO },
        { tipo: 'hrv', valores: { ms: data.hrv }, fecha: fechaISO },
        { tipo: 'oxigeno', valores: { spo2: data.ox }, fecha: fechaISO },
        {
          tipo: 'temperatura',
          valores: { grados: data.temperature },
          fecha: fechaISO,
        },
        { tipo: 'pasos', valores: { pasos: data.step }, fecha: fechaISO },
        {
          tipo: 'bateria',
          valores: { porcentaje: data.batteryLevel },
          fecha: fechaISO,
        },
        {
          tipo: 'movimiento',
          valores: { cuenta: data.motionDetectionCount },
          fecha: fechaISO,
        },
      );
    });

    // Se dispara cuando el servicio confirma que la descarga de históricos ha
    // terminado de verdad. Solo borramos los históricos del propio anillo si
    // estamos SEGUROS de que el guardado local salió bien -- borrar es
    // irreversible, así que nunca lo hacemos "a ciegas".
    this.escuchar(this.ringBLEservice.historicalDataCompleta$, async () => {
      const guardadoOk =
        await this.historialAnilloService.guardarMedicionesEnLote(
          this.bufferHistoricoParaGuardar,
        );
      this.bufferHistoricoParaGuardar = [];

      if (guardadoOk) {
        console.log(
          '[SINCRONIZACIÓN] Guardado local confirmado. Limpiando históricos del anillo...',
        );
        await this.ringBLEservice.clearHistoricalData();
      } else {
        console.error(
          '[SINCRONIZACIÓN] El guardado local falló -- NO se borran los históricos del anillo, para no perder datos.',
        );
      }
    });

    // La descarga se cortó (el anillo no se pudo reconectar): guardamos lo
    // recibido, pero NO se borra nada del anillo porque faltan registros
    this.escuchar(this.ringBLEservice.historicalDataAbortada$, async () => {
      await this.historialAnilloService.guardarMedicionesEnLote(
        this.bufferHistoricoParaGuardar,
      );
      this.bufferHistoricoParaGuardar = [];
    });

    // Suscripción a los pasos del día (y cálculo de calorías asociado)
    this.escuchar(this.ringBLEservice.stepData$, (data: any) => {
      if (data && data.stepCount !== undefined) {
        this.steps = data.stepCount;
        this.calories = this.ringBLEservice.calculateCalories(
          this.userHeight,
          data.stepCount,
          this.exerciseIntensity,
        );
        this.cdr.detectChanges();

        // Guardado de datos
        this.historialAnilloService.guardarMedicion('pasos', {
          pasos: data.stepCount,
          calorias: Number(this.calories) || 0,
        });
      }
    });

    // Cada vez que se guarda algo redibujamos las gráficas automáticamente
    // Si llegan varios guardados seguidos (p. ej. una descarga), se agrupan
    // en una sola recarga de las gráficas
    this.escuchar(
      this.historialAnilloService.datosActualizados$.pipe(debounceTime(300)),
      () => this.cargarGraficasDesdeAlmacenamiento(),
    );

    // Cargamos las gráficas por primera vez, esté o no conectado el anillo
    this.cargarGraficasDesdeAlmacenamiento();
  }

  /**
   * Escanea y se conecta a un anillo NexRing cercano.
   * Si es la primera vez, además lo vincula y sincroniza la hora del dispositivo.
   */
  async search4ring() {
    this.buscando = true;
    try {
      await this.buscarYConectarAnillo();
    } finally {
      this.buscando = false;
      this.cdr.detectChanges();
    }
  }

  /** Escaneo y conexión en sí; separado para poder marcar "Buscando…" alrededor. */
  private async buscarYConectarAnillo() {
    const device = await this.ringBLEservice.scan();

    if (device) {
      this.avisar(`Anillo encontrado: ${device.name}`);

      const succesfulConnexion = await this.ringBLEservice.connect();

      if (succesfulConnexion) {
        this.ringName = device.name || 'anillo sin nombre';
        this.ringID = device.deviceId;
        this.connected = true;
        this.hasRing = true;

        // Guardamos el ID para poder reconectar automáticamente en el futuro
        localStorage.setItem('anillo_vinculado', this.ringID);

        await this.ringBLEservice.receiveData();

        // Solo vinculamos si es la primera vez que conectamos este anillo
        const isBound = localStorage.getItem(`vinculado${this.ringID}`);
        if (isBound !== 'si') {
          await this.ringBLEservice.deviceBind();
          localStorage.setItem(`vinculado${this.ringID}`, 'si');
        }
        await this.ringBLEservice.timesynchro();
        this.iniciarDescargaHistoricosAutomatica();
      } else {
        this.avisar('Se encontró anillo pero no se pudo conectar');
      }
    } else {
      console.log('No seleccionado ningun dispositivo');
    }
  }

  /**
   * Desvincula el anillo actual: borra la vinculación guardada y desconecta.
   */
  async unbinding() {
    await this.ringBLEservice.deviceUnbind();
    await timemgt.sleep(1000);
    localStorage.removeItem(`vinculado${this.ringID}`);
    localStorage.removeItem('anillo_vinculado');
    await this.ringBLEservice.disconnect();
    this.hasRing = false;
  }

  /**
   * Desconecta el anillo sin desvincularlo (se podrá reconectar automáticamente).
   */
  async disconnecting() {
    await timemgt.sleep(1000);
    await this.ringBLEservice.disconnect();
  }

  /**
   * Apaga físicamente el dispositivo.
   */
  async shutdown() {
    await timemgt.sleep(1000);
    await this.ringBLEservice.shutdownDevice();
  }

  /**
   * Punto de entrada común para lanzar cualquier medición/consulta al anillo.
   * Si el anillo está en modo reposo (dormido), intenta despertarlo primero
   * reconectando de forma silenciosa antes de mandar el comando real.
   *
   * @param measure - Tipo de medición/consulta a solicitar al anillo.
   * @param registerNumber - Número de registros esperados (solo para históricos).
   * @returns true si el comando se llegó a enviar al anillo.
   */
  async startMeasuring(
    measure:
      | 'batteryDataAndState'
      | 'temperature'
      | 'openSingleHealth'
      | 'openHealth'
      | 'deviceInfo1'
      | 'deviceInfo2'
      | 'deviceInfo5'
      | 'historicalData'
      | 'historicalNum'
      | 'step',
    registerNumber: number = 0,
  ): Promise<boolean> {
    const savedID = localStorage.getItem('anillo_vinculado');
    if (!savedID) return false;

    if (!this.connected) {
      this.avisar('Anillo dormido, intentando despertar');
      const ok = await this.ringBLEservice.connectSilently(savedID);

      if (!ok) {
        this.avisar('No se pudo conectar al anillo');
        return false;
      }
      await this.ringBLEservice.timesynchro();
      await this.ringBLEservice.receiveData();
    }
    await this.ringBLEservice.activateMeasurements(measure, registerNumber);
    return true;
  }

  /**
   * Lanza una medición puntual mostrando "Midiendo…" en su tarjeta hasta que
   * llega el resultado, falla, o vence el tiempo máximo de espera.
   */
  private async iniciarMedicion(
    tipo: 'pulso' | 'oxigeno' | 'temperatura',
    comando: 'openSingleHealth' | 'openHealth' | 'temperature',
  ) {
    this.midiendo = tipo;
    this.errorMedicion = null;

    // Red de seguridad: si el anillo se desconecta no llega respuesta alguna
    this.temporizadorMedicion = setTimeout(
      () => {
        // Damos de baja el listener para que una respuesta tardía no se guarde
        this.ringBLEservice.detenerMedicionSalud();
        this.finalizarMedicion('El anillo no respondió a tiempo.');
      },
      TIEMPO_MAXIMO_MEDICION_MS,
    );

    const enviado = await this.startMeasuring(comando);
    if (!enviado) this.finalizarMedicion();
  }

  /** Detiene a petición del usuario la medición de pulso/HRV u oxígeno en curso. */
  detenerMedicion() {
    this.finalizarMedicion();
    this.ringBLEservice.detenerMedicionSalud();
  }

  /** Quita el indicador "Midiendo…" y, si se indica, muestra un error. */
  private finalizarMedicion(error: string | null = null) {
    clearTimeout(this.temporizadorMedicion);
    this.midiendo = null;
    this.errorMedicion = error;
    this.cdr.detectChanges();
  }

  /** Solicita medición de oxígeno (y pulso) al anillo. */
  async measuringOX() {
    this.modoMedicionActual = 'oxigeno';
    await this.iniciarMedicion('oxigeno', 'openHealth');
  }

  /** Solicita medición de HRV (y pulso) al anillo. */
  async measuringHRV() {
    this.modoMedicionActual = 'hrv';
    await this.iniciarMedicion('pulso', 'openSingleHealth');
  }

  /** Solicita la temperatura del dedo al anillo. */
  async fingerTemperature() {
    await this.iniciarMedicion('temperatura', 'temperature');
  }

  /**
   * Solicita toda la información del dispositivo, una petición detrás de otra:
   * Info 1 (dirección BLE, versión), Info 2 (número de serie, vinculación) e
   * Info 5 (configuración de pulso y oxígeno).
   */
  async actualizarInfoDispositivo() {
    for (const comando of ['deviceInfo1', 'deviceInfo2', 'deviceInfo5'] as const) {
      const enviado = await this.startMeasuring(comando);
      if (!enviado) return; // Sin conexión: no tiene sentido seguir pidiendo
    }
  }

  /**
   * Cambia de sección. Al entrar en Dispositivo refresca su información, pero
   * solo si el anillo ya está conectado, para no despertarlo y gastar batería.
   */
  cambiarSeccion(seccion: 'medidas' | 'historicos' | 'dispositivo') {
    this.seccion = seccion;
    if (seccion === 'dispositivo' && this.connected) {
      this.actualizarInfoDispositivo();
    }
  }

  /** Solicita el estado de la batería. */
  async measuringBattery() {
    this.startMeasuring('batteryDataAndState');
  }

  /** Restaura el anillo a los ajustes de fábrica. */
  async restoreFactorySettings() {
    this.ringBLEservice.restoreSettings();
  }

  /** Reinicia el dispositivo. */
  async deviceRestart() {
    this.ringBLEservice.restartDevice();
  }

  /** Limpia todos los datos históricos guardados en el propio anillo. */
  async clearHistData() {
    await this.ringBLEservice.clearHistoricalData();
  }

  /**
   * Descarga todos los datos históricos del anillo: solicita el número total de
   * registros, lo que dispara en cascada la descarga real de cada uno.
   * Las gráficas se actualizan solas al guardarse los registros.
   */
  async downloadHistoricalData() {
    this.medicalHist = [];
    this.startMeasuring('historicalNum');
  }

  /**
   * Calcula los datos de sueño (profundo, ligero, REM, despierto) a partir
   * del historial ya descargado. Requiere haber llamado antes a downloadHistoricalData().
   */
  async sleepdata() {
    if (this.medicalHist.length === 0) {
      console.warn('Esperando a tener datos...');
      return;
    }

    try {
      const resultados = await this.ringBLEservice.calculateSleep(
        this.medicalHist,
      );

      if (resultados && Array.isArray(resultados) && resultados.length > 0) {
        const noche = resultados[0];

        // Usamos '--' como valor por defecto por si cambia la estructura del SDK
        this.deepSleepTime = noche?.DeepSleep || '--';
        this.lightSleepTime = noche?.LightTime || '--';
        this.REMsleepTime = noche?.RemTime || '--';
        this.wakeTime = noche?.WakeTime || '--';
        this.sleepStartTime = noche?.SleepTimePeriod?.startTime || '--';
        this.sleepEndTime = noche?.SleepTimePeriod?.endTime || '--';

        this.historialAnilloService.guardarMedicion(
          'sueno',
          {
            profundo: Number(this.deepSleepTime) || 0,
            ligero: Number(this.lightSleepTime) || 0,
            rem: Number(this.REMsleepTime) || 0,
          },
          new Date(this.sleepStartTime).toISOString(),
        );

        this.cdr.detectChanges();
      }
    } catch (error) {
      console.error('Erro procesando el sueño en el home: ', error);
    }
  }

  /**
   * Calcula SpO2 nocturna, frecuencia respiratoria e inmersión del pulso a
   * partir del historial descargado, y las guarda en el histórico local.
   * TODO - Pendiente de comprobar con datos reales de una noche.
   */
  async calcularMetricasSueno() {
    if (this.medicalHist.length === 0) {
      this.avisar('Primero hay que descargar los históricos');
      return;
    }

    const noches = await this.ringBLEservice.calculateSleep(this.medicalHist);
    const periodos = Array.isArray(noches)
      ? noches.map((noche: any) => noche?.SleepTimePeriod).filter(Boolean)
      : [];
    if (periodos.length === 0) {
      this.avisar('No hay datos de sueño suficientes');
      return;
    }

    const [oxigeno, respiracion, inmersion] = await Promise.all([
      this.ringBLEservice.calcOxygenSaturation(periodos, this.medicalHist),
      this.ringBLEservice.calcRespiratoryRate(periodos, this.medicalHist),
      this.ringBLEservice.calculateHeartRateImmersion(
        periodos,
        this.medicalHist,
      ),
    ]);
    console.log('Métricas nocturnas en bruto:', {
      oxigeno,
      respiracion,
      inmersion,
    });

    type TipoNocturno = 'oxigenoNocturno' | 'respiracion' | 'inmersion';
    const lote: {
      tipo: TipoNocturno;
      valores: Record<string, number>;
      fecha: string;
    }[] = [];

    /** Añade un registro al lote si la marca de tiempo y el valor son válidos. */
    const anadir = (
      tipo: TipoNocturno,
      campo: string,
      marca: any,
      valor: any,
    ) => {
      const fecha = new Date(marca);
      if (!Number.isNaN(fecha.getTime()) && Number.isFinite(Number(valor))) {
        lote.push({
          tipo,
          valores: { [campo]: Number(valor) },
          fecha: fecha.toISOString(),
        });
      }
    };
    oxigeno.forEach((n: any) =>
      anadir('oxigenoNocturno', 'spo2', n.StartTime, n.Oxygen),
    );
    respiracion.forEach((n: any) =>
      anadir('respiracion', 'rpm', n.StartTime, n.respiratoryRate),
    );
    inmersion.forEach((n: any) =>
      anadir('inmersion', 'porcentaje', n.time, n.heartRateImmersion),
    );

    if (lote.length === 0) {
      this.avisar('El anillo no devolvió métricas del sueño');
      return;
    }

    // Resumen: el dato más reciente de cada métrica
    const ultimo = (tipo: TipoNocturno) =>
      lote.filter((r) => r.tipo === tipo).pop()?.valores;
    const ox = ultimo('oxigenoNocturno');
    this.oxigenoNocturno = ox ? Math.round(ox['spo2']) : '--';
    const resp = ultimo('respiracion');
    this.respiracion = resp ? Math.round(resp['rpm']) : '--';
    const inm = ultimo('inmersion');
    this.inmersion = inm ? inm['porcentaje'] : '--';
    this.cdr.detectChanges();

    this.historialAnilloService.guardarMedicionesEnLote(lote);
  }

  /**
   * Calcula la evolución del pulso en reposo día a día, a partir del historial
   * ya descargado, y la guarda en el histórico local.
   */
  async calculateRestingHeartRate() {
    if (this.medicalHist.length === 0) {
      this.avisar('Primero hay que descargar los históricos');
      return;
    }

    const resultado = await this.ringBLEservice.restingHeartRate(
      this.medicalHist,
      -1,
    );

    console.log('Resultado de RESTING HEART RATE en bruto: ', resultado);

    if (
      resultado !== null &&
      Array.isArray(resultado) &&
      resultado.length > 0
    ) {
      // Mostramos en el resumen el dato del día más reciente
      const ultimoRegistro = resultado[resultado.length - 1];
      this.restingHeartRate = Math.floor(ultimoRegistro.data);
      this.cdr.detectChanges();

      // Guardamos todos los días de una vez (una sola escritura), cada uno con
      // su fecha real; la gráfica se redibuja sola al guardarse
      this.historialAnilloService.guardarMedicionesEnLote(
        resultado.map((diaReposo: any) => ({
          tipo: 'reposo' as const,
          valores: { bpm: Math.floor(diaReposo.data) },
          fecha: diaReposo.ts, // Timestamp del propio día, no el momento actual
        })),
      );
    } else {
      console.log('No hay datos suficientes de pulso en reposo.');
      this.restingHeartRate = '--';
    }
  }

  /**
   * Lee del almacenamiento local las métricas guardadas del anillo dentro del
   * rango de fechas elegido y actualiza los puntos de cada gráfica.
   * No depende de que el anillo esté conectado: lee siempre de lo guardado.
   */
  async cargarGraficasDesdeAlmacenamiento() {
    const desde = calcularFechaDesde(this.rangoGraficasSeleccionado);

    // Una sola lectura del almacén para todas las gráficas
    const {
      pulso = [],
      hrv = [],
      oxigeno = [],
      temperatura = [],
      pasos = [],
      bateria = [],
      movimiento = [],
      reposo = [],
      oxigenoNocturno: oxNoche = [],
      respiracion: resp = [],
      inmersion: inmer = [],
    } = await this.historialAnilloService.obtenerAgrupadoPorTipo(desde);

    // Las claves coinciden con las de "graficas"
    this.puntosGraficas = {
      pulso: aPuntos(pulso, 'bpm'),
      hrv: aPuntos(hrv, 'ms'),
      spo2: aPuntos(oxigeno, 'spo2'),
      temperatura: aPuntos(temperatura, 'grados'),
      pasos: aPuntos(pasos, 'pasos'),
      movimiento: aPuntos(movimiento, 'cuenta'),
      bateria: aPuntos(bateria, 'porcentaje'),
      reposo: aPuntos(reposo, 'bpm'),
      oxigenoNocturno: aPuntos(oxNoche, 'spo2'),
      respiracion: aPuntos(resp, 'rpm'),
      inmersion: aPuntos(inmer, 'porcentaje'),
    };

    this.cdr.detectChanges();
  }

  /** Se llama cuando el usuario cambia el selector de rango de fechas. */
  async cambiarRangoGraficas(rango: RangoGrafica) {
    this.rangoGraficasSeleccionado = rango;
    await this.cargarGraficasDesdeAlmacenamiento();
  }

  /**
   * Activa o desactiva el modo deporte. Al activarlo, programa un apagado
   * automático transcurrida la duración configurada, por si el usuario
   * se olvida de detenerlo manualmente.
   */
  async toggleSportMode() {
    if (!this.connected) {
      this.avisar('El anillo no está conectado');
      return;
    }

    this.isSportMode = !this.isSportMode;

    const interval = 30; // Cada cuántos segundos registra datos
    const duration = 5; // Duración total de la actividad (minutos)
    const mode = 1; // 0: ciclismo/natación, 1: caminar/correr

    if (this.isSportMode) {
      await this.ringBLEservice.setSportMode(
        this.isSportMode,
        interval,
        duration,
        mode,
      );

      // Apagado automático de seguridad al terminar la duración configurada
      const duration_ms = duration * 60 * 1000 + 2000;
      this.sportTimeoutId = setTimeout(async () => {
        this.isSportMode = false;
        console.log('El modo deporte ha terminado por límite de tiempo');
        await this.ringBLEservice.setSportMode(
          this.isSportMode,
          interval,
          duration,
          mode,
        );
        this.cdr.detectChanges();
      }, duration_ms);
    } else {
      // Si se apaga manualmente antes de tiempo, cancelamos la alarma automática
      if (this.sportTimeoutId) clearTimeout(this.sportTimeoutId);

      await this.ringBLEservice.setSportMode(
        this.isSportMode,
        interval,
        duration,
        mode,
      );
    }
    this.cdr.detectChanges();
  }

  /** Solicita los pasos actuales del día (dispara también el cálculo de calorías). */
  async dailyActivity() {
    this.startMeasuring('step');
  }

  /**
   * Inicia automáticamente la descarga de datos históricos en cuanto hay conexión,
   * sin esperar a que el usuario pulse ningún botón.
   */
  private iniciarDescargaHistoricosAutomatica() {
    this.startMeasuring('historicalNum');
  }

  /**
   * Activa la medición automática de oxígeno con el intervalo que el usuario
   * haya elegido en el desplegable (ion-select).
   */
  async activarOxigenoAutomatico() {
    // Le pasamos al servicio: encender=true, y el número de minutos elegido
    await this.ringBLEservice.configurarOxigenoAutomatico(
      true,
      this.intervaloOxigenoSeleccionado,
    );
  }

  /**
   * Desactiva la medición automática de oxígeno.
   * No hace falta pasarle el intervalo porque al apagar (encender=false) el
   * anillo simplemente ignora ese dato.
   */
  async desactivarOxigenoAutomatico() {
    await this.ringBLEservice.configurarOxigenoAutomatico(false);
  }

  /**
   * Se ejecuta cada vez que el usuario mueve el interruptor. Según su nueva
   * posición, activa o desactiva la medición automática con el intervalo elegido.
   */
  async cambiarEstadoOxigenoAutomatico() {
    // Si el cambio viene de la información del anillo, no hay nada que enviar
    if (this.oxAutomaticoActivo === this.oxAutomaticoEnAnillo) return;
    this.oxAutomaticoEnAnillo = this.oxAutomaticoActivo;

    if (this.oxAutomaticoActivo) {
      await this.activarOxigenoAutomatico();
    } else {
      await this.desactivarOxigenoAutomatico();
    }
  }
}
