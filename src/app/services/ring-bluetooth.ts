import { Injectable } from '@angular/core';
import {
  BleClient,
  BleDevice,
  numbersToDataView,
} from '@capacitor-community/bluetooth-le';
import { ble_config } from '../constants/ble-config';
import { timemgt } from '../constants/aux-funct';
import { BehaviorSubject, Subject } from 'rxjs';

declare var require: any;
const SDK = require('../../assets/lib/ringSDK');

/** Reconexiones automáticas permitidas en una misma descarga de históricos. */
const MAX_RECONEXIONES_HISTORICOS = 3;

/**
 * Servicio encargado de toda la comunicación Bluetooth con el anillo NexRing,
 * usando el SDK oficial del fabricante (ringSDK.js).
 *
 * Expone los datos de cada sensor a través de Observables de RxJS (Subject/BehaviorSubject),
 * de forma que cualquier componente de la app puede suscribirse sin acoplarse
 * directamente a la lógica de comunicación BLE.
 */

// TODO - Secciones del manual SDK que se han obviado:
//   1) 2.5.19 - OEM Certification (certificacion del fabricante)
//   2) 2.5.20 - OTA (Actualizacion firmware)
//   3) 2.5.23-2.5.24 - PPG Raw Data (Datos crudos)
//   8) 2.5.29 - Filtrado de datos históricos (ObtainValidHistoricalData) — sustituido por
//      nuestro propio filtro de validez (isWorn/notCharging/validHeartRate), ver activateMeasurements
//   9) 2.5.30-2.5.31 - Fluctuación de temperatura y estrés (el manual dice que son solo demo)
//   10) 2.5.32 - Umbral de conteo de pasos

@Injectable({
  providedIn: 'root',
})
export class RingBluetooth {
  /* VARIABLES DE ESTADO */
  private ring_device: BleDevice | null = null;

  // Control de la descarga de históricos, para poder reconectar solos si el
  // anillo entra en reposo a mitad de la transferencia (ocurre cada ~30s)
  private descargandoHistoricos: boolean = false;

  // Medición de salud en curso: guardamos el MISMO objeto listener registrado,
  // porque el SDK solo lo da de baja si recibe exactamente ese objeto
  private medicionSalud: {
    listener: any;
    cierre: 'closeHealth' | 'closeSingleHealth';
  } | null = null;
  private ultimoDeviceId: string | null = null;
  private intentosReconexionHistoricos: number = 0; // Reconexiones hechas en la descarga actual
  private listenerHistoricos: any = null; // Mismo objeto registrado, necesario para poder darlo de baja

  /* CANALES (Observables) PARA COMUNICAR DATOS AL RESTO DE LA APP */
  public healthData$ = new Subject<any>();
  public healthDataFallida$ = new Subject<void>(); // Avisa si una medición de salud termina sin lectura estable
  public connection_state$ = new BehaviorSubject<boolean>(false);
  public batteryData$ = new Subject<any>();
  public deviceInfo1$ = new Subject<any>();
  public deviceInfo2$ = new Subject<any>();
  public temperatureData$ = new Subject<any>();
  public historicalData$ = new Subject<any>(); // Ya solo emite registros validados (ver activateMeasurements)
  public historicalNum$ = new Subject<any>();
  public stepData$ = new Subject<any>();
  public comandoConfirmado$ = new Subject<any>(); // Confirma si cada comando fue aceptado por el anillo o no
  private rePackageListenerRegistrado: boolean = false; // Para no registrar listener más de una vez
  public deviceInfo5$ = new Subject<any>();
  public historicalDataCompleta$ = new Subject<void>(); // Avisa cuando la descarga de históricos termina de verdad
  public historicalDataAbortada$ = new Subject<void>(); // Avisa si la descarga se corta antes de recibirlo todo

  constructor() {}
  /**
   * Escanea dispositivos Bluetooth cercanos filtrando por el UUID del NexRing.
   */
  async scan(): Promise<BleDevice | null> {
    try {
      await BleClient.initialize();
      console.log('Bluetooth inicializado. Iniciando escaneo...');

      this.ring_device = await BleClient.requestDevice({
        services: [ble_config.FILTER_UUID],
        optionalServices: [
          ble_config.SERVICE_UUID,
          ble_config.WRITE_UUID,
          ble_config.NOTIFY_UUID,
        ],
      });

      return this.ring_device;
    } catch (error) {
      console.error('El escaneo falló o fue cancelado:', error);
      return null;
    }
  }

  /**
   * Establece la conexión física BLE con el anillo previamente escaneado.
   * Si el anillo se desconecta mientras hay una descarga de históricos en curso,
   * dispara la reconexión automática.
   *
   * @returns true si la conexión tuvo éxito, false en caso contrario.
   */
  async connect(): Promise<boolean> {
    if (!this.ring_device) {
      console.error('No hay anillo seleccionado');
      return false;
    }
    try {
      console.log(`Conectando a ${this.ring_device.deviceId}`);

      await BleClient.connect(this.ring_device.deviceId, this.alDesconectarse);

      this.connection_state$.next(true);
      this.registrarConfirmacionComandos();
      this.ultimoDeviceId = this.ring_device.deviceId; // Guardamos el ID por si hace falta reconectar solos
      console.log('El dispositivo se ha conectado');
      return true;
    } catch (error) {
      console.error('Error al conectar: ', error);
      return false;
    }
  }

  /**
   * Se ejecuta cuando el anillo se desconecta (normalmente porque entra en
   * reposo para ahorrar batería). Si había una descarga de históricos a
   * medias, intenta reconectar. Es una función flecha para poder pasarla
   * directamente a BleClient.connect sin perder "this".
   */
  private alDesconectarse = (deviceId: string): void => {
    console.warn(
      `El dispositivo ${deviceId} se ha desconectado o puesto en modo reposo`,
    );
    this.ring_device = null;
    this.connection_state$.next(false);
    this.reconectarSiDescargandoHistoricos();
  };

  /**
   * Registra, una sola vez por sesión, el listener que confirma si el anillo
   * acepta o rechaza cada comando enviado.
   */
  private registrarConfirmacionComandos(): void {
    if (this.rePackageListenerRegistrado) return;
    this.rePackageListenerRegistrado = true;
    SDK.default.registerRePackageListener({
      onResult: (data: any) => {
        console.log(
          '[CONFIRMACIÓN COMANDO]',
          'cmd:',
          data.cmd,
          '| resultado:',
          data.result,
          '| razón:',
          data.reason,
        );
        this.comandoConfirmado$.next(data);
      },
    });
  }

  /**
   * Desconecta físicamente el anillo de forma explícita (por ejemplo, al desvincular).
   *
   * @returns Siempre false — FIXME: revisar este valor de retorno, parece inconsistente.
   */
  async disconnect(): Promise<boolean> {
    if (this.ring_device) {
      try {
        await BleClient.disconnect(this.ring_device.deviceId);
        this.ring_device = null;
        this.connection_state$.next(false);
        return false; // FIXME - debería ser "true" si la desconexión fue exitosa
      } catch (error) {
        console.error('Error al desconectar: ', error);
      }
    }
    return false;
  }

  /**
   * Reconecta directamente usando un ID de dispositivo guardado previamente,
   * sin pasar por el escaneo manual. Se usa para "despertar" el anillo cuando
   * entra en modo de ahorro de energía.
   *
   * @param deviceId - ID Bluetooth guardado de una conexión anterior.
   */
  async connectSilently(deviceId: string): Promise<boolean> {
    try {
      await BleClient.initialize();
      console.log('Intentando reconexión directa a ', deviceId);

      try {
        // Intentamos conectar directo, como siempre -- esto es lo que ya
        // funcionaba bien cuando el anillo se dormía con la página aún abierta
        await BleClient.connect(deviceId, this.alDesconectarse);
      } catch (errorConexionDirecta) {
        // Solo llegamos aquí si la conexión directa falló -- típicamente porque
        // se recargó la página y el navegador "olvidó" la referencia del dispositivo.
        // Intentamos recuperarla con getDevices() como último recurso.
        console.warn(
          '[RECONEXIÓN] Conexión directa falló, intentando recuperar referencia del dispositivo...',
        );

        try {
          const dispositivosConocidos = await BleClient.getDevices([deviceId]);
          if (dispositivosConocidos.length === 0) {
            console.warn(
              '[RECONEXIÓN] El navegador no reconoce este dispositivo tras recargar.',
            );
            return false;
          }
        } catch (errorGetDevices) {
          console.warn(
            '[RECONEXIÓN] Este navegador no soporta la recuperación automática. Habrá que reconectar a mano.',
          );
          return false;
        }

        // Ahora que recuperamos la referencia (si el navegador lo soporta),
        // reintentamos la conexión de verdad
        await BleClient.connect(deviceId, this.alDesconectarse);
      }

      this.ring_device = { deviceId: deviceId } as BleDevice;
      this.connection_state$.next(true);
      this.registrarConfirmacionComandos();
      this.ultimoDeviceId = deviceId;
      return true;
    } catch (error) {
      console.error('[RECONEXIÓN] ERROR AL RECONECTAR:', error);
      console.error('Error: ', error);
      return false;
    }
  }

  /**
   * Se ejecuta automáticamente cuando el anillo se desconecta (entra en reposo).
   * Si estábamos a mitad de una descarga de históricos, reconecta solo y vuelve
   * a pedir los datos, sin necesidad de que el usuario haga nada.
   */
  // TODO - No está confirmado si el anillo reanuda el envío desde donde se quedó
  // o si vuelve a mandar todos los registros desde el principio (el manual no lo
  // especifica). Por eso el filtrado por "uuid" en activateMeasurements protege
  // contra ambos casos, contando cada registro una sola vez.

  private async reconectarSiDescargandoHistoricos(): Promise<void> {
    if (!this.descargandoHistoricos || !this.ultimoDeviceId) return;

    // Sin límite, una descarga que nunca completa el recuento reconectaría el
    // anillo cada vez que se duerme, gastando su batería indefinidamente
    if (this.intentosReconexionHistoricos >= MAX_RECONEXIONES_HISTORICOS) {
      console.warn(
        `[AUTO-RECONEXIÓN] Superados ${MAX_RECONEXIONES_HISTORICOS} intentos. Se aborta la descarga de históricos.`,
      );
      this.abortarDescargaHistoricos();
      return;
    }
    this.intentosReconexionHistoricos++;

    console.log(
      '[AUTO-RECONEXIÓN] El anillo se durmió a mitad de la descarga de históricos. Reconectando...',
    );
    await timemgt.sleep(500);

    const ok = await this.connectSilently(this.ultimoDeviceId);
    console.log('[RECONEXIÓN] Resultado:', ok ? 'ÉXITO' : 'FALLO');
    if (ok) {
      await this.timesynchro();
      await this.receiveData();
      // El listener original sigue registrado en el SDK (no depende de la conexión BLE),
      // así que solo hace falta reenviar la solicitud para que el anillo vuelva a mandar datos
      await this.sendData('historicalData');
    } else {
      console.error(
        '[AUTO-RECONEXIÓN] No se pudo reconectar. Se aborta la descarga de históricos.',
      );
      this.abortarDescargaHistoricos();
    }
  }

  /**
   * Da por terminada una descarga de históricos incompleta: deja de escuchar
   * registros y avisa a la app para que guarde lo recibido. No se debe borrar
   * nada del anillo, porque quedan registros sin descargar.
   */
  private abortarDescargaHistoricos(): void {
    this.descargandoHistoricos = false;
    if (this.listenerHistoricos) {
      SDK.default.unregisterHistoricalDataListener(this.listenerHistoricos);
      this.listenerHistoricos = null;
    }
    this.historicalDataAbortada$.next();
  }

  /**
   * Envía un comando al anillo. El SDK traduce el comando y los datos a bytes crudos,
   * que se escriben directamente en la característica BLE de escritura del anillo.
   */
  async sendData(cmd: string, data: any = null): Promise<void> {
    if (!this.ring_device) return;

    try {
      const payload = data ? data : {};
      const result = SDK.default.startDetect(cmd, payload);

      const array_bytes = Array.from(new Uint8Array(result));
      const data_view = numbersToDataView(array_bytes);

      await BleClient.write(
        this.ring_device.deviceId,
        ble_config.SERVICE_UUID,
        ble_config.WRITE_UUID,
        data_view,
      );
      console.log(`Comando '${cmd}' enviado con éxito al anillo.`);
    } catch (error) {
      console.error(`Error al enviar comando ${error}`);
    }
  }

  /**
   * Se suscribe a las notificaciones BLE del anillo y reenvía cada dato crudo al SDK.
   */
  async receiveData(): Promise<void> {
    if (!this.ring_device) {
      console.error('No se puede enviar datos, no hay anillo conectado');
      return;
    }

    try {
      await BleClient.startNotifications(
        this.ring_device.deviceId,
        ble_config.SERVICE_UUID,
        ble_config.NOTIFY_UUID,
        (data_view) => {
          const value = new Uint8Array(data_view.buffer);
          SDK.default.pushRawData(value);
        },
      );
    } catch (error) {
      console.error(`Error al recibir datos ${error}`);
    }
  }

  /** Envía el comando de vinculación (bind) al anillo. */
  async deviceBind(): Promise<void> {
    console.log('Solicitando vinculación con el anillo');
    try {
      await this.sendData('deviceBind');
    } catch (error) {
      console.log('Error vinculacion:', error);
    }
  }

  /** Envía el comando de desvinculación (unbind) al anillo. */
  async deviceUnbind(): Promise<void> {
    try {
      console.log('Solicitamos desvinculacion con el anillo');
      await this.sendData('deviceUnBind');
      await timemgt.sleep(1000);
    } catch (error) {
      console.log('La desvinculación ha dado error: ', error);
    }
  }

  /** Envía el comando de apagado físico del anillo. */
  async shutdownDevice(): Promise<void> {
    console.log('Solicitamos apagar el dispositivo');
    await this.sendData('shutDown');
  }

  /** Sincroniza la hora del anillo con la hora actual del dispositivo móvil. */
  async timesynchro(): Promise<void> {
    try {
      console.log('Solicitamos que sincronice el tiempo');
      const timePayload = { timestamp: Date.now() };
      await this.sendData('timeSyn', timePayload);
      await timemgt.sleep(1000);
    } catch (error) {
      console.log('ERROR EN TIMESYNC: ', error);
    }
  }

  /** Restaura el anillo a los ajustes de fábrica. */
  async restoreSettings(): Promise<void> {
    console.log('Solicitamos que se restaure a ajustes de fábrica');
    await this.sendData('restoreFactorySettings');
  }

  /** Reinicia el dispositivo. */
  async restartDevice(): Promise<void> {
    console.log('Solicitamos al anillo que se reinicie');
    await this.sendData('restart');
  }

  /** Limpia todos los datos históricos almacenados en el propio anillo. */
  async clearHistoricalData(): Promise<void> {
    console.log('Solicitamos que se limpien los datos históricos');
    await this.sendData('cleanHistoricalData');
  }

  /**
   * Punto de entrada central para activar cualquier tipo de medición o consulta al anillo.
   */
  async activateMeasurements(
    type: string,
    reghistNum: number = 0,
  ): Promise<void> {
    try {
      let isClosing = false;

      if (type === 'closeHealth' || type === 'closeSingleHealth') {
        await this.sendData(type);
        return;
      } else if (type === 'temperature') {
        const temperatureListener = {
          onResult: async (data: any) => {
            this.temperatureData$.next(data);
            isClosing = true;
            SDK.default.unregisterTemperatureListener(temperatureListener);
          },
        };
        SDK.default.registerTemperatureListener(temperatureListener);
        await this.sendData(type);
        return;
      } else if (type === 'step') {
        const stepListener = {
          onResult: async (data: any) => {
            this.stepData$.next(data);
            isClosing = true;
            SDK.default.unregisterStepListener(stepListener);
          },
        };
        SDK.default.registerStepListener(stepListener);
        await this.sendData(type);
        return;
      } else if (type === 'historicalNum') {
        const historicalNumListener = {
          onResult: async (data: any) => {
            this.historicalNum$.next(data);
            isClosing = true;
            SDK.default.unregisterHistoricalNumListener(historicalNumListener);
          },
        };
        SDK.default.registerHistoricalNumListener(historicalNumListener);
        await this.sendData(type);
        return;
      } /* DESCARGA DE LOS DATOS HISTÓRICOS */ else if (
        type === 'historicalData'
      ) {
        this.descargandoHistoricos = true; // Activamos el control de reconexión automática
        this.intentosReconexionHistoricos = 0;
        let register_counter = 0;
        // Evita contar/emitir el mismo registro dos veces si el anillo reenvía
        // datos ya recibidos tras una reconexión automática
        const seenUuids = new Set<number>();

        const historicalDataListener = {
          onResult: async (data: any) => {
            if (seenUuids.has(data.uuid)) return; // Registro duplicado, lo ignoramos
            seenUuids.add(data.uuid);

            // Filtro de validez movido aquí desde el front: solo emitimos registros
            // fiables (anillo puesto, sin cargar, pulso en rango fisiológico razonable)
            const isWorn = data.wearStatus === 1;
            const notCharging = data.chargeStatus === 0;
            const validHeartRate =
              data.heartRate >= 50 && data.heartRate <= 175;
            register_counter++;
            isClosing = true;

            if (isWorn && notCharging && validHeartRate) {
              this.historicalData$.next(data);
            }

            if (register_counter >= reghistNum) {
              console.log(
                '✅ DESCARGA COMPLETA: se han recibido todos los registros históricos',
              );
              this.descargandoHistoricos = false; // Descarga completa, desactivamos el control
              SDK.default.unregisterHistoricalDataListener(
                historicalDataListener,
              );
              this.listenerHistoricos = null;
              this.historicalDataCompleta$.next(); // Avisamos de que la descarga ha terminado de verdad
            }
          },
        };
        // Si quedaba el listener de una descarga anterior, lo damos de baja
        // para que no haya dos procesando los mismos registros
        if (this.listenerHistoricos) {
          SDK.default.unregisterHistoricalDataListener(this.listenerHistoricos);
        }
        this.listenerHistoricos = historicalDataListener;
        SDK.default.registerHistoricalDataListener(historicalDataListener);
        await this.sendData(type);
        return;
      } else if (type === 'batteryDataAndState') {
        const batteryListener = {
          onResult: async (data: any) => {
            this.batteryData$.next(data);
            isClosing = true;
            SDK.default.unregisterBatteryDataAndStateListener(batteryListener);
          },
        };
        SDK.default.registerBatteryDataAndStateListener(batteryListener);

        await this.sendData(type);
        return;
      } else if (type === 'deviceInfo1') {
        const deviceInfo1Listener = {
          onResult: async (data: any) => {
            this.deviceInfo1$.next(data);
            isClosing = true;
            SDK.default.unregisterDeviceInfo1Listener(deviceInfo1Listener);
          },
        };
        SDK.default.registerDeviceInfo1Listener(deviceInfo1Listener);
        await this.sendData(type);
        return;
      } else if (type === 'deviceInfo2') {
        const deviceInfo2Listener = {
          onResult: async (data: any) => {
            this.deviceInfo2$.next(data);
            isClosing = true;
            SDK.default.unregisterDeviceInfo2Listener(deviceInfo2Listener);
          },
        };
        SDK.default.registerDeviceInfo2Listener(deviceInfo2Listener);
        await this.sendData(type);
        return;
      } else if (type === 'deviceInfo5') {
        const deviceInfo5Listener = {
          onResult: async (data: any) => {
            this.deviceInfo5$.next(data);
            isClosing = true;
            SDK.default.unregisterDeviceInfo5Listener(deviceInfo5Listener);
          },
        };
        SDK.default.registerDeviceInfo5Listener(deviceInfo5Listener);
        await this.sendData(type);
        return;
      } else if (type === 'openSingleHealth' || type === 'openHealth') {
        // FIXME - EN MEDICIONES PUNTUALES CAPTURA DATOS MUY DISPARES
        let countAttempts = 0;
        let ultimaLecturaPlausible: {
          heartValue: number;
          oxValue: number;
          hrvValue: number;
        } | null = null;

        const healthListener = {
          onResult: async (data: any) => {
            if (isClosing) return;

            countAttempts++;
            // status: 0 sin empezar, 1 midiendo, 2 válido (manual 2.5.7).
            // errCode no está documentado; se registra para poder estudiarlo
            console.log(
              `[SALUD] intento ${countAttempts} | status ${data?.status} | errCode ${data?.errCode}`,
            );

            if (data && data.status == 2) {
              // Paso 1: descartamos valores físicamente imposibles en una persona
              // consciente (errores de sensor: mal contacto, movimiento, etc.)
              const oxigenoImposible = data.oxValue > 0 && data.oxValue < 70;
              const pulsoImposible =
                data.heartValue < 30 || data.heartValue > 220;

              if (!oxigenoImposible && !pulsoImposible) {
                // Paso 2: no basta con que sea plausible por sí sola -- comprobamos
                // que coincide con la lectura anterior dentro de un margen razonable
                // (el sensor necesita un par de lecturas seguidas para estabilizarse;
                // una sola lectura plausible puede seguir siendo ruido de sensor)
                if (ultimaLecturaPlausible) {
                  const diferenciaPulso = Math.abs(
                    data.heartValue - ultimaLecturaPlausible.heartValue,
                  );
                  const diferenciaOxigeno = Math.abs(
                    data.oxValue - ultimaLecturaPlausible.oxValue,
                  );

                  const esEstable =
                    diferenciaPulso <= 5 && diferenciaOxigeno <= 1;

                  if (esEstable) {
                    // Dos lecturas seguidas coinciden de verdad: la damos por buena
                    isClosing = true;
                    this.medicionSalud = null;
                    this.healthData$.next(data);
                    SDK.default.unregisterHealthListener(healthListener);
                    await timemgt.sleep(300);
                    const closeCmd =
                      type === 'openSingleHealth'
                        ? 'closeSingleHealth'
                        : 'closeHealth';
                    await this.sendData(closeCmd);
                    return;
                  }
                }

                // Aún no hay estabilidad (o es la primera lectura plausible) --
                // la guardamos como referencia para comparar con la siguiente
                ultimaLecturaPlausible = {
                  heartValue: data.heartValue,
                  oxValue: data.oxValue,
                  hrvValue: data.hrvValue,
                };
              }
            }

            if (!isClosing && countAttempts >= 15) {
              console.warn('Demasiados intentos de comunicación');
              isClosing = true;
              this.medicionSalud = null;
              SDK.default.unregisterHealthListener(healthListener);
              this.healthDataFallida$.next();
              const closeCmd =
                type === 'openSingleHealth'
                  ? 'closeSingleHealth'
                  : 'closeHealth';
              await this.sendData(closeCmd);
            }
          },
        };

        this.medicionSalud = {
          listener: healthListener,
          cierre: type === 'openSingleHealth' ? 'closeSingleHealth' : 'closeHealth',
        };
        SDK.default.registerHealthListener(healthListener);
        await this.sendData(type);
      }
    } catch (error) {
      console.error('El error es: ', error);
    }
  }

  /**
   * Detiene a petición del usuario la medición de salud en curso (pulso/HRV u
   * oxígeno): da de baja su listener y manda al anillo el comando de cierre.
   * El anillo no avisa si falta el dedo (el manual no lo documenta), así que
   * esta es la forma de no esperar a que se agoten los intentos.
   */
  async detenerMedicionSalud(): Promise<void> {
    if (!this.medicionSalud) return;
    const { listener, cierre } = this.medicionSalud;
    this.medicionSalud = null;
    SDK.default.unregisterHealthListener(listener);
    await this.sendData(cierre);
  }

  /**
   * Calcula los datos de sueño a partir del historial descargado previamente.
   *
   * FIXME - El manual (2.5.14) especifica módulos nativos por plataforma
   * (NativeSleepModule/SleepDataModule), no esta llamada directa. Pendiente
   * de verificar en dispositivo real.
   */
  async calculateSleep(hitoricalArray: any[]): Promise<any> {
    try {
      console.log(
        'CalculateSleep: Analizando',
        hitoricalArray.length,
        'registros con calcSleepTime...',
      );
      const sleepResults = SDK.default.calcSleepTime(hitoricalArray);
      console.log('¡Resultados crudos del sueño!', sleepResults);
      return sleepResults;
    } catch (error) {
      console.error('Error al calcular el sueño:', error);
      return null;
    }
  }

  /**
   * TODO - Sin implementar (manual 2.5.15). Ya disponemos de calculateSleep()
   * para obtener el sleepTimeArray necesario.
   */
  async calcOxygenSaturation(
    sleepTimeArray: any[],
    historicalDataArray: any[],
  ): Promise<any> {
    // TODO - Sin datos de sueño no se puede hacer (pero ya tenemos calculateSleep() disponible)
  }

  /**
   * TODO - Sin implementar (manual 2.5.16). Ya disponemos de calculateSleep()
   * para obtener el sleepTimeArray necesario.
   */
  async calcRespiratoryRate(
    sleepTimeArray: any[],
    historicalDataArray: any[],
    timeStamp: string,
  ): Promise<any> {
    // TODO - Sin datos de sueño no se puede hacer (pero ya tenemos calculateSleep() disponible)
  }

  /** Calcula el pulso en reposo a partir del historial de pulso. */
  async restingHeartRate(HrArray: any[], timeStamp: number = -1): Promise<any> {
    try {
      console.log('Calculando resting HR');
      const datosAdaptados = HrArray.map((registro) => ({
        ts: registro.timeStamp,
        hr: registro.heartRate,
        hrv: registro.hrv,
        motion: registro.motionDetectionCount,
        steps: registro.step,
      }));

      const restingResult = SDK.default.calcRestingHeartRate(
        datosAdaptados,
        timeStamp,
      );

      return restingResult;
    } catch (error) {
      console.error('Error en el calculo de restinHeartRate: ', error);
      return;
    }
  }

  /**
   * TODO - Sin implementar (manual 2.5.18).
   * TODO - El propio historicalDataArray ya contiene el pulso, se podría
   * simplificar generando heartRateArray internamente.
   */
  async calculateHeartRateImmersion(
    sleepTimeArray: any[],
    historicalDataArray: any[],
    heartRateArray: any[],
    timeStamp: string,
  ): Promise<any> {
    // TODO - Sin datos de sueño no se puede hacer
    // TODO - Se puede simplificar extrayendo heartRateArray del propio historicalDataArray
  }

  /** Activa o desactiva el modo deporte del anillo. */
  async setSportMode(
    turnOnSportsMode: boolean,
    timeInterval: number = 30,
    duration: number = 30,
    mode: number = 1,
  ): Promise<void> {
    try {
      const sportsSwitch = turnOnSportsMode ? 1 : 0;

      if (turnOnSportsMode) {
        console.log('Servicio: iniciando modo deporte...');
        await this.sendData('step');
        await timemgt.sleep(1000);
        await this.sendData('SetSportModeParameters', {
          switch: sportsSwitch,
          timeInterval: timeInterval,
          duration: duration,
          mode: mode,
        });
      } else {
        console.log('Servicio: Deteniendo modo deporte...');
        await this.sendData('SetSportModeParameters', {
          switch: sportsSwitch,
          timeInterval: timeInterval,
          duration: duration,
          mode: mode,
        });
        await timemgt.sleep(1000);
        await this.sendData('step');
      }
    } catch (error) {
      console.error('Ha surgido un error en el SPORTMODE: ', error);
    }
  }

  /** Calcula las calorías quemadas según altura, pasos e intensidad del ejercicio. */
  calculateCalories(
    personalHeight: number,
    step: number,
    strengthGrade: number,
  ): string | number {
    try {
      console.log(`Calculando calorías para ${step} pasos...`);
      const calorías = SDK.default.caloriesCalculation(
        personalHeight,
        step,
        strengthGrade,
      );
      return calorías;
    } catch (error) {
      console.error('Error calculando calorías: ', error);
      return '--';
    }
  }

  /**
   * Configura la medición automática de oxígeno durante la noche.
   * Solo aplica entre las 0:00 y las 6:00 (según el manual, 2.5.25) — el anillo
   * ignora este ajuste fuera de esa ventana horaria.
   *
   * @param encender - true para activar la medición automática, false para desactivarla.
   * @param intervaloMinutos - Cada cuántos minutos medir (rango válido: 5-360).
   */
  async configurarOxigenoAutomatico(
    encender: boolean,
    intervaloMinutos: number = 15,
  ): Promise<void> {
    // Comprobación de seguridad: el manual dice que fuera de 5-360 minutos no es válido,
    // así que si alguien pasa un número raro, avisamos y no mandamos nada al anillo
    if (intervaloMinutos < 5 || intervaloMinutos > 360) {
      console.error(
        `Intervalo fuera de rango (5-360 minutos): ${intervaloMinutos}`,
      );
      return;
    }

    console.log(
      `Configurando oxígeno automático: ${encender ? 'ON' : 'OFF'} cada ${intervaloMinutos} min`,
    );

    // Mandamos el comando 'oxSettings' con los dos parámetros que pide el SDK:
    // switch (1 encendido / 0 apagado) y timeInterval (minutos entre mediciones)
    await this.sendData('oxSettings', {
      switch: encender ? 1 : 0,
      timeInterval: intervaloMinutos,
    });
  }
}
