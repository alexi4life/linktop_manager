import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HistorialAnilloService } from '../services/ring-historial.service';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonCard,
  IonCardContent,
  IonButton,
  IonIcon,
  IonToggle,
  IonSelect,
  IonSelectOption,
  IonSegmentButton,
  IonSegment,
  IonLabel,
} from '@ionic/angular/standalone';
import { RingBluetooth } from '../services/ring-bluetooth';
import { timemgt } from '../constants/aux-funct';
import Chart from 'chart.js/auto';
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
    IonCard,
    IonCardContent,
    IonButton,
    IonIcon,
    IonSelect,
    IonToggle,
    IonSelectOption,
    CommonModule,
    FormsModule,
    IonSegmentButton,
    IonSegment,
    IonLabel,
  ],
})
export class RingHomePage implements OnInit {
  // CONTROL DE VISTA (pestañas internas: info / vivo / históricos / usuario)
  vistaActual: string = 'info';

  // VARIABLES DE CONEXIÓN
  ringName: string = ''; // Nombre del anillo una vez conectado
  ringID: string = ''; // ID Bluetooth del anillo
  connected: boolean = false; // Si está conectado en este momento
  hasRing: boolean = false; // Si ya tenemos un anillo vinculado guardado

  // VARIABLES DE MEDICIÓN EN VIVO
  pulso: number | string = '---';
  oxigeno: number | string = '--';
  hrv: number | string = '--'; // Variabilidad de la frecuencia cardíaca
  bateria: number | string = '---'; // Porcentaje de batería
  estadobateria: string = '--'; // Si está cargando o no
  temperatura: number | string = '--';

  // VARIABLES DE INFORMACIÓN DEL DISPOSITIVO
  bleAddress: string = '--';
  deviceVer: string = '';
  sn: string = '--'; // Número de serie
  bindStatus: string = '--'; // Si está vinculado o no
  samplingRate: string = '--'; // Frecuencia de muestreo del PPG
  hrMeasurementTime: number | string = '--'; // Tiempo de medición de pulso, en segundos
  oxMeasurementInterval: number | string = '--'; // Intervalo de medición de oxígeno, en minutos
  oxMeasurementSwitch: string = '--'; // Si el oxígeno automático está encendido o no
  oxAutomaticoActivo: boolean = false;

  // VARIABLES DE DATOS HISTÓRICOS
  registerNum: number = 0; // Número de registros históricos disponibles
  isHistData: boolean = false;
  medicalHist: any[] = []; // Array con todos los registros históricos válidos
  public histChart_hearRate: any;
  public histChart_HRV: any;
  public histChart_motion: any;
  public histChart_temperature: any;
  public histChart_step: any;
  public histChart_ox: any;
  public histChart_baterryLevel: any;

  // VARIABLES DE SUEÑO
  deepSleepTime: number | string = '--';
  lightSleepTime: number | string = '--';
  REMsleepTime: number | string = '--';
  wakeTime: number | string = '--';
  sleepStartTime: number | string = '--';
  sleepEndTime: number | string = '--';

  // VARIABLES DE PULSO EN REPOSO
  restingHeartRate: number | string = '--';
  public chartRestingHearRate: any;

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

  // Rango de fechas seleccionado para las gráficas de datos guardados
  rangoGraficasSeleccionado: '24h' | '7d' | '30d' | 'todo' = '7d';

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
    }

    console.log(
      'Detectado anillo previamente vinculado. Conectando automáticamente...',
    );

    // Si hay ID guardado, intentamos reconectar sin pasar por el escaneo manual
    const conectadoOk = await this.ringBLEservice.connectSilently(this.ringID);
    if (conectadoOk) {
      await this.ringBLEservice.timesynchro();
      await this.ringBLEservice.receiveData();
      console.log('Se ha reconectado con el anillo');
      this.iniciarDescargaHistoricosAutomatica();
    } else {
      console.warn('No se ha detectado anillo vinculado');
    }

    // Suscripción al estado de conexión (se actualiza solo/desconecta cada ~30s)
    this.ringBLEservice.connection_state$.subscribe((estado) => {
      console.log(
        '[CONEXIÓN]',
        estado ? 'CONECTADO' : 'DESCONECTADO',
        new Date().toLocaleTimeString(),
      );

      this.connected = estado;
      this.cdr.detectChanges();
    });

    this.ringBLEservice.comandoConfirmado$.subscribe((data) => {
      console.log(
        '[HOME] Comando',
        data.cmd,
        data.result === 'success' ? '✅ ACEPTADO' : '❌ RECHAZADO',
        '- razón:',
        data.reason,
      );
    });

    // Suscripción a la información 1 del dispositivo (dirección BLE, versión...)
    this.ringBLEservice.deviceInfo1$.subscribe((data: any) => {
      this.bleAddress = data.bleAddress;
      this.deviceVer = data.deviceVer;
      this.cdr.detectChanges();
    });

    // Suscripción a la información 2 del dispositivo (número de serie, vinculación...)
    this.ringBLEservice.deviceInfo2$.subscribe((data: any) => {
      this.sn = data.sn;
      this.bindStatus = data.bindStatus;
      this.samplingRate = data.samplingRate;
      this.cdr.detectChanges();
    });

    // Suscripción a la información 5 del dispositivo (número de serie, vinculación...)
    this.ringBLEservice.deviceInfo5$.subscribe((data: any) => {
      this.hrMeasurementTime = data.hrMeasurementTime;
      this.oxMeasurementInterval = data.oxMeasurementInterval;
      this.oxMeasurementSwitch =
        data.oxMeasurementSwitch === 1 ? 'Encendido' : 'Apagado';
      this.cdr.detectChanges();
    });

    // Suscripción a los datos de salud en vivo (pulso, oxígeno, HRV)
    this.ringBLEservice.healthData$.subscribe((data: any) => {
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

    // Suscripción al estado de la batería
    this.ringBLEservice.batteryData$.subscribe((data: any) => {
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
    this.ringBLEservice.temperatureData$.subscribe((data: any) => {
      this.temperatura = data;
      this.cdr.detectChanges();

      //Guardado de datos
      this.historialAnilloService.guardarMedicion('temperatura', {
        grados: data,
      });
    });

    // Suscripción al número total de registros históricos disponibles.
    // En cuanto llega, lanzamos automáticamente la descarga de esos históricos.
    this.ringBLEservice.historicalNum$.subscribe((data: any) => {
      if (data.num && data.num > 0) {
        this.registerNum = data.num;
        this.startMeasuring('historicalData', this.registerNum);
      } else {
        console.log('No hay registros');
        this.registerNum = data.num;
      }
      this.cdr.detectChanges();
    });

    this.ringBLEservice.historicalData$.subscribe((data: any) => {
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
    this.ringBLEservice.historicalDataCompleta$.subscribe(async () => {
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

    // Suscripción a los pasos del día (y cálculo de calorías asociado)
    this.ringBLEservice.stepData$.subscribe((data: any) => {
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
    this.historialAnilloService.datosActualizados$.subscribe(() => {
      this.cargarGraficasDesdeAlmacenamiento();
    });

    // Cargamos las gráficas por primera vez.
    setTimeout(() => {
      this.cargarGraficasDesdeAlmacenamiento();
    }, 300);
  }

  /**
   * Crea las 7 gráficas de históricos (pulso, HRV, movimiento,
   * temperatura, pasos, oxígeno y nivel de batería), buscando cada canvas por su ID.
   * Se ejecuta solo la primera vez que se descargan históricos.
   */
  crearGrafica_historicos() {
    const lienzoHeartRate = document.getElementById(
      'graficaHeartRate',
    ) as HTMLCanvasElement;
    const lienzoHRV = document.getElementById(
      'graficaHRV',
    ) as HTMLCanvasElement;
    const lienzoMotion = document.getElementById(
      'graficaMotion',
    ) as HTMLCanvasElement;
    const lienzoTemperature = document.getElementById(
      'graficaTemperature',
    ) as HTMLCanvasElement;
    const lienzoStep = document.getElementById(
      'graficaStep',
    ) as HTMLCanvasElement;
    const lienzoOx = document.getElementById('graficaOx') as HTMLCanvasElement;
    const lienzoBaterryLevel = document.getElementById(
      'graficaBatteryLevel',
    ) as HTMLCanvasElement;

    // Si algún canvas no está en el DOM todavía, abortamos sin crear nada
    if (
      !lienzoHeartRate ||
      !lienzoHRV ||
      !lienzoMotion ||
      !lienzoStep ||
      !lienzoOx ||
      !lienzoTemperature ||
      !lienzoBaterryLevel
    )
      return;

    this.histChart_hearRate = new Chart(lienzoHeartRate, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'Pulso (ppm)', data: [], borderColor: 'red', tension: 0.4 },
        ],
      },
      options: { responsive: true },
    });

    this.histChart_HRV = new Chart(lienzoHRV, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'HRV (ms)', data: [], borderColor: 'green', tension: 0.4 },
        ],
      },
      options: { responsive: true },
    });

    this.histChart_motion = new Chart(lienzoMotion, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: '¿?', data: [], borderColor: 'yellow', tension: 0.4 },
        ],
      },
      options: { responsive: true },
    });

    this.histChart_temperature = new Chart(lienzoTemperature, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Temperatura',
            data: [],
            borderColor: 'orange',
            tension: 0.4,
          },
        ],
      },
      options: { responsive: true },
    });

    this.histChart_step = new Chart(lienzoStep, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'Pasos', data: [], borderColor: 'blue', tension: 0.4 },
        ],
      },
      options: { responsive: true },
    });

    this.histChart_ox = new Chart(lienzoOx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'SpO2 (%)', data: [], borderColor: 'cyan', tension: 0.4 },
        ],
      },
      options: { responsive: true },
    });

    this.histChart_baterryLevel = new Chart(lienzoBaterryLevel, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          { label: '%', data: [], backgroundColor: 'green', borderRadius: 4 },
        ],
      },
      options: { responsive: true },
    });
  }

  /**
   * Crea la gráfica de evolución del pulso en reposo (una barra por día).
   */
  crearGrafica_restingHR() {
    const lienzo = document.getElementById(
      'graficaRestingHR',
    ) as HTMLCanvasElement;

    if (!lienzo) return;

    this.chartRestingHearRate = new Chart(lienzo, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Pulso en reposo (Bpm)',
            data: [],
            backgroundColor: 'red',
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
      },
    });
  }

  /**
   * Escanea y se conecta a un anillo NexRing cercano.
   * Si es la primera vez, además lo vincula y sincroniza la hora del dispositivo.
   */
  async search4ring() {
    const device = await this.ringBLEservice.scan();

    if (device) {
      alert(`Escaneo con exito. Seleccionado: ${device.name}`);

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
        alert('Se encontró anillo pero no se pudo conectar');
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
  ) {
    const savedID = localStorage.getItem('anillo_vinculado');
    if (!savedID) return;

    if (!this.connected) {
      alert('Anillo dormido, intentando despertar');
      const ok = await this.ringBLEservice.connectSilently(savedID);

      if (!ok) {
        alert('No se pudo conectar al anillo');
        return;
      }
      await this.ringBLEservice.timesynchro();
      await this.ringBLEservice.receiveData();
    }
    await this.ringBLEservice.activateMeasurements(measure, registerNumber);
  }

  /** Solicita medición de oxígeno (y pulso) al anillo. */
  async measuringOX() {
    this.startMeasuring('openHealth');
    this.modoMedicionActual = 'oxigeno';
  }

  /** Solicita medición de HRV (y pulso) al anillo. */
  async measuringHRV() {
    this.startMeasuring('openSingleHealth');
    this.modoMedicionActual = 'hrv';
  }

  /** Solicita la temperatura del dedo al anillo. */
  async fingerTemperature() {
    this.startMeasuring('temperature');
  }

  /** Solicita la información 1 del dispositivo (color, tamaño, dirección BLE...). */
  async measuringInfoDevice1() {
    this.startMeasuring('deviceInfo1');
  }

  /** Solicita la información 2 del dispositivo (número de serie, vinculación...). */
  async measuringInfoDevice2() {
    this.startMeasuring('deviceInfo2');
  }

  /** Solicita la información 5 del dispositivo (config. de pulso y oxígeno). */
  async measuringInfoDevice5() {
    this.startMeasuring('deviceInfo5');
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
    await this.ringBLEservice.sendData('cleanHistoricalData');
  }

  /**
   * Descarga todos los datos históricos: vacía las gráficas existentes
   * (o las crea si es la primera vez) y solicita el número total de registros,
   * lo que dispara en cascada la descarga real de cada registro.
   */
  async downloadHistoricalData() {
    this.medicalHist = [];
    if (this.histChart_hearRate) {
      // Si las gráficas ya existen, las vaciamos para no duplicar datos antiguos
      this.histChart_hearRate.data.labels = [];
      this.histChart_hearRate.data.datasets[0].data = [];
      this.histChart_hearRate.update();

      this.histChart_HRV.data.labels = [];
      this.histChart_HRV.data.datasets[0].data = [];
      this.histChart_HRV.update();

      this.histChart_motion.data.labels = [];
      this.histChart_motion.data.datasets[0].data = [];
      this.histChart_motion.update();

      this.histChart_temperature.data.labels = [];
      this.histChart_temperature.data.datasets[0].data = [];
      this.histChart_temperature.update();

      this.histChart_step.data.labels = [];
      this.histChart_step.data.datasets[0].data = [];
      this.histChart_step.update();

      this.histChart_ox.data.labels = [];
      this.histChart_ox.data.datasets[0].data = [];
      this.histChart_ox.update();

      this.histChart_baterryLevel.data.labels = [];
      this.histChart_baterryLevel.data.datasets[0].data = [];
      this.histChart_baterryLevel.update();
    } else {
      this.crearGrafica_historicos();
    }
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
        this.sleepStartTime = noche?.SleepTimePeriod.startTime || '--';
        this.sleepEndTime = noche?.SleepTimePeriod.endTime || '--';

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
   * Calcula la evolución del pulso en reposo día a día, a partir del historial
   * ya descargado, y dibuja/actualiza la gráfica correspondiente.
   */
  async calculateRestingHeartRate() {
    if (this.medicalHist.length === 0) {
      alert('Primero hay que descargar los históricos');
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

      if (!this.chartRestingHearRate) {
        this.crearGrafica_restingHR();
      } else {
        // Vaciamos la gráfica anterior para no duplicar datos
        this.chartRestingHearRate.data.labels = [];
        this.chartRestingHearRate.data.datasets[0].data = [];
      }

      // Recorremos todo el historial devuelto para pintar la gráfica completa
      resultado.forEach((diaReposo: any) => {
        const fecha = new Date(diaReposo.ts);
        const dia = fecha.getDate().toString().padStart(2, '0');
        const mes = (fecha.getMonth() + 1).toString().padStart(2, '0');

        this.chartRestingHearRate.data.labels.push(`${dia}/${mes}`);
        this.chartRestingHearRate.data.datasets[0].data.push(
          Math.floor(diaReposo.data),
        );
        // Guardamos también en el histórico local, con la fecha real de ese día
        this.historialAnilloService.guardarMedicion(
          'reposo',
          { bpm: Math.floor(diaReposo.data) },
          diaReposo.ts, // Timestamp del propio día, no el momento actual
        );
      });

      this.chartRestingHearRate.update();
    } else {
      console.log('No hay datos suficientes de pulso en reposo.');
      this.restingHeartRate = '--';
    }
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
        return new Date(0); // Desde el origen de los tiempos -- incluye todo
    }
  }

  /**
   * Lee del almacenamiento local las 8 métricas guardadas (pulso, hrv, oxígeno,
   * temperatura, pasos, batería, movimiento, pulso en reposo), filtradas por el
   * rango de fechas seleccionado, y redibuja las gráficas desde cero.
   * No depende de que el anillo esté conectado -- lee siempre de lo guardado.
   */
  async cargarGraficasDesdeAlmacenamiento() {
    if (!this.histChart_hearRate) {
      this.crearGrafica_historicos();
    }
    if (!this.chartRestingHearRate) {
      this.crearGrafica_restingHR();
    }

    const desde = this.calcularFechaDesde();

    const [
      pulso,
      hrv,
      oxigeno,
      temperatura,
      pasos,
      bateria,
      movimiento,
      reposo,
    ] = await Promise.all([
      this.historialAnilloService.obtenerHistorialPorTipoYFecha('pulso', desde),
      this.historialAnilloService.obtenerHistorialPorTipoYFecha('hrv', desde),
      this.historialAnilloService.obtenerHistorialPorTipoYFecha(
        'oxigeno',
        desde,
      ),
      this.historialAnilloService.obtenerHistorialPorTipoYFecha(
        'temperatura',
        desde,
      ),
      this.historialAnilloService.obtenerHistorialPorTipoYFecha('pasos', desde),
      this.historialAnilloService.obtenerHistorialPorTipoYFecha(
        'bateria',
        desde,
      ),
      this.historialAnilloService.obtenerHistorialPorTipoYFecha(
        'movimiento',
        desde,
      ),
      this.historialAnilloService.obtenerHistorialPorTipoYFecha(
        'reposo',
        desde,
      ),
    ]);

    // Ordenamos cada lista por fecha (más antigua primero) para que la gráfica
    // se dibuje en orden cronológico correcto
    const ordenarPorFecha = (lista: any[]) =>
      lista.sort(
        (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime(),
      );
    [
      pulso,
      hrv,
      oxigeno,
      temperatura,
      pasos,
      bateria,
      movimiento,
      reposo,
    ].forEach(ordenarPorFecha);

    // Formatea una fecha ISO al mismo estilo "día/mes hora:min" que usábamos antes
    const formatearFecha = (fechaISO: string) => {
      const f = new Date(fechaISO);
      const dia = f.getDate().toString().padStart(2, '0');
      const mes = (f.getMonth() + 1).toString().padStart(2, '0');
      const horas = f.getHours().toString().padStart(2, '0');
      const mins = f.getMinutes().toString().padStart(2, '0');
      return `${dia}/${mes} ${horas}:${mins}`;
    };

    // Volcamos cada lista en su gráfica, sustituyendo los datos por completo
    this.histChart_hearRate.data.labels = pulso.map((r) =>
      formatearFecha(r.fecha),
    );
    this.histChart_hearRate.data.datasets[0].data = pulso.map(
      (r) => r.valores['bpm'],
    );
    this.histChart_hearRate.update();

    this.histChart_HRV.data.labels = hrv.map((r) => formatearFecha(r.fecha));
    this.histChart_HRV.data.datasets[0].data = hrv.map((r) => r.valores['ms']);
    this.histChart_HRV.update();

    this.histChart_ox.data.labels = oxigeno.map((r) => formatearFecha(r.fecha));
    this.histChart_ox.data.datasets[0].data = oxigeno.map(
      (r) => r.valores['spo2'],
    );
    this.histChart_ox.update();

    this.histChart_temperature.data.labels = temperatura.map((r) =>
      formatearFecha(r.fecha),
    );
    this.histChart_temperature.data.datasets[0].data = temperatura.map(
      (r) => r.valores['grados'],
    );
    this.histChart_temperature.update();

    this.histChart_step.data.labels = pasos.map((r) => formatearFecha(r.fecha));
    this.histChart_step.data.datasets[0].data = pasos.map(
      (r) => r.valores['pasos'],
    );
    this.histChart_step.update();

    this.histChart_baterryLevel.data.labels = bateria.map((r) =>
      formatearFecha(r.fecha),
    );
    this.histChart_baterryLevel.data.datasets[0].data = bateria.map(
      (r) => r.valores['porcentaje'],
    );
    this.histChart_baterryLevel.update();

    this.histChart_motion.data.labels = movimiento.map((r) =>
      formatearFecha(r.fecha),
    );
    this.histChart_motion.data.datasets[0].data = movimiento.map(
      (r) => r.valores['cuenta'],
    );
    this.histChart_motion.update();

    this.chartRestingHearRate.data.labels = reposo.map((r) =>
      formatearFecha(r.fecha),
    );
    this.chartRestingHearRate.data.datasets[0].data = reposo.map(
      (r) => r.valores['bpm'],
    );
    this.chartRestingHearRate.update();

    this.cdr.detectChanges();
  }

  /** Se llama cuando el usuario cambia el selector de rango de fechas. */
  async cambiarRangoGraficas() {
    await this.cargarGraficasDesdeAlmacenamiento();
  }

  /**
   * Activa o desactiva el modo deporte. Al activarlo, programa un apagado
   * automático transcurrida la duración configurada, por si el usuario
   * se olvida de detenerlo manualmente.
   */
  async toggleSportMode() {
    if (!this.connected) {
      alert('El anillo no está conectado');
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
   * sin esperar a que el usuario pulse ningún botón. Espera un instante para asegurar
   * que Angular ya ha pintado los <canvas> en el DOM antes de crear las gráficas.
   */
  private iniciarDescargaHistoricosAutomatica() {
    setTimeout(() => {
      if (!this.histChart_hearRate) {
        this.crearGrafica_historicos();
      }
      this.startMeasuring('historicalNum');
    }, 300);
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
    if (this.oxAutomaticoActivo) {
      await this.activarOxigenoAutomatico();
    } else {
      await this.desactivarOxigenoAutomatico();
    }
  }
}
