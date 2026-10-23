import { Injectable } from '@angular/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { ExceptionCode } from '@capacitor/core';

declare var Engine: any;

// Parametros de conexión del bluetooth (health monitor)
const LINKTOP_UUIDS = {
  SERVICE_HEALTH_DETECT: '0000ff27-0000-1000-8000-00805f9b34fb',
  CHARACTERISTIC_HEART_RATE_WRITE: '0000fff1-0000-1000-8000-00805f9b34fb',
  CHARACTERISTIC_HEART_RATE_MEASUREMENT: '0000fff4-0000-1000-8000-00805f9b34fb',
  DESCRIPTORS_GENERAL: '00002901-0000-1000-8000-00805f9b34fb',
  DEV_INFO_SER_UUID: '0000180a-0000-1000-8000-00805f9b34fb',
  DEV_INFO_FIRMWARE_REV_UUID: '00002a26-0000-1000-8000-00805f9b34fb',
  DEV_INFO_HARDWARE_PCB_UUID: '00002a27-0000-1000-8000-00805f9b34fb',
  DEV_INFO_SOFTWARE_REV_UUID: '00002a28-0000-1000-8000-00805f9b34fb',
};

// Tipos de medición, tal como los define el manual oficial del HC03 (sección 2.3.2)
const Detection = {
  BP: 'Blood Pressure',
  BT: 'Blood Temperature',
  BG: 'Blood Glucose',
  OX: 'Blood Oxygen',
  ECG: 'Electrocardiogram',
  BATTERY: 'Battery',
};

@Injectable({
  providedIn: 'root',
})
export class LinktopService {
  // Variables
  private dispositivoConectado: any = null;
  private SDK: any = null;
  private cancelado: boolean = false;
  private datosObtenidosECG: boolean = false;
  private medicionECGFinalizando: boolean = false; // Evita llamar a cancelarMedicion() varias veces en bucle
  // Variables para parar el funcionamiento de la medida de oxigeno
  private medicionOXFinalizando: boolean = false; // Mismo control único que en ECG
  private oxigenoActivo: boolean = false; // Si hay una medición de oxígeno en curso ahora mismo
  private oxigenoTiempoInicio: number = 0;
  private oxigenoOnEnd: (() => void) | null = null;
  private oxigenoOnInterrumpida: (() => void) | null = null;

  constructor() {
    this.SDK = (window as any).default;
  }

  /** Nombre Bluetooth del monitor conectado, o cadena vacía si no hay ninguno. */
  get nombreDispositivo(): string {
    return this.dispositivoConectado?.name ?? '';
  }

  /**
   * Inicializa el módulo y el hardware de Bluetooth Low Energy (BLE) en el dispositivo.
   * Es el punto de entrada obligatorio antes de intentar cualquier escaneo o conexión
   * con el monitor de salud.
   *
   * @returns {Promise<string>} Mensaje de confirmación del estado del hardware o el error detallado.
   */
  async inicializarBluetooth(): Promise<string> {
    try {
      // Inicialización del cliente nativo de BLE en la plataforma
      await BleClient.initialize();
      return 'Bluetooth listo. Esperando escaneo...';
    } catch (error) {
      return 'Error al iniciar el Bluetooth' + error;
    }
  }

  /**
   * Escanea dispositivos BLE cercanos, establece la conexión física e inicializa el SDK de salud.
   * * Configura un flujo bidireccional de datos:
   * 1. **SDK -> Dispositivo:** Los comandos generados por el algoritmo del SDK se escriben en el hardware (`onDataPost`).
   * 2. **Dispositivo -> SDK:** Las respuestas del hardware se inyectan directamente al SDK (`startNotifications`).
   *
   * @returns {Promise<string>} Mensaje de éxito con el nombre del dispositivo o descripción del error.
   */
  async escanearConectar(): Promise<string> {
    try {
      // 1. Escaneo y selección del dispositivo mediante filtro por UUID de servicio
      const device = await BleClient.requestDevice({
        services: [LINKTOP_UUIDS.SERVICE_HEALTH_DETECT],
      });
      this.dispositivoConectado = device;

      // 2. Conexión física con el hardware
      await BleClient.connect(device.deviceId);

      // 3. Inicialización del SDK (Actúa como puente entre las capacidades nativas y la App)
      if (this.SDK && typeof this.SDK.initSdk === 'function') {
        const appInterface = {
          onModeChange: (mode: any) => {
            console.log('[SDK] Modo cambiado: ', mode);

            // Respaldo confirmado necesario: en este dispositivo, onProcess nunca llega
            // a 5 para oxígeno (visto en logs reales) -- el aviso real de que el sensor
            // terminó llega aquí, cuando el modo pasa a null
            if (
              mode === null &&
              this.oxigenoActivo &&
              !this.medicionOXFinalizando
            ) {
              this.medicionOXFinalizando = true;
              this.oxigenoActivo = false;

              const segundosTranscurridos =
                (Date.now() - this.oxigenoTiempoInicio) / 1000;

              console.log(
                `[OX] Fin por onModeChange(null) a los ${segundosTranscurridos.toFixed(1)} s`,
              );
              if (segundosTranscurridos >= 30) {
                if (this.oxigenoOnEnd) this.oxigenoOnEnd();
              } else {
                // El SDK cambia de modo (p. ej. por otro startDetect) aunque el
                // monitor siga midiendo: lo paramos para que app y aparato coincidan
                this.cancelarMedicion('OX');
                if (this.oxigenoOnInterrumpida) this.oxigenoOnInterrumpida();
              }
            }
          },
          onException: (error: any) => {
            console.log('[SDK] Excepción global:', error);
          },
          /**
           * Intercepta los bytes generados por el algoritmo del SDK
           * y los envía físicamente al monitor de salud.
           */
          onDataPost: async (data: any) => {
            // Formateo de bytes a Hexadecimal para facilitar la depuración en consola
            if (this.dispositivoConectado) {
              try {
                await BleClient.write(
                  this.dispositivoConectado.deviceId,
                  LINKTOP_UUIDS.SERVICE_HEALTH_DETECT,
                  LINKTOP_UUIDS.CHARACTERISTIC_HEART_RATE_WRITE, // Característica fff1
                  new DataView(new Uint8Array(data).buffer),
                );
              } catch (error) {
                console.error('Error al transmitir comando del SDK:', error);
              }
            }
          },
        };

        // Inyección de la interfaz obligatoria para evitar crasheos en el SDK
        this.SDK.initSdk(appInterface);
      }

      // 4. Escucha activa de respuestas (Suscripción a notificaciones del hardware)
      // Redirige los bytes puros (raw data) recibidos directamente hacia el algoritmo del SDK
      await BleClient.startNotifications(
        device.deviceId,
        LINKTOP_UUIDS.SERVICE_HEALTH_DETECT,
        LINKTOP_UUIDS.CHARACTERISTIC_HEART_RATE_MEASUREMENT,
        (value: DataView) => {
          if (this.SDK && this.SDK.pushRawData) {
            this.SDK.pushRawData(value.buffer);
          }
        },
      );

      return 'Conectado con éxito a ' + device.name;
    } catch (error) {
      // Captura tanto fallos de conexión como la cancelación del escaneo por parte del usuario
      return 'Error o escaneo cancelado: ' + error;
    }
  }

  /**
   * Obtiene la información del dispositivo Bluetooth que se encuentra actualmente
   * conectado o en proceso de conexión.
   *
   * @returns El objeto del dispositivo BLE guardado en el estado, o undefined/null si no hay ninguno.
   */
  obtenerDispositivo() {
    return this.dispositivoConectado;
  }

  /**
   * Inicia el proceso de medición de la temperatura corporal a través del SDK.
   * Configura los escuchadores (listeners) para monitorizar el progreso, capturar anomalías
   * y transmitir el valor final obtenido por el hardware.
   *
   * @param callback - Función de retorno que recibe el resultado final de la temperatura una vez concluido el análisis.
   */
  medicionTemperatura(callback: (resultado: any) => void) {
    if (this.SDK && this.SDK.registerBTListener) {
      this.SDK.registerBTListener({
        onProcess: (process: any) => {
          // El SDK informa del progreso mediante un estado numérico de control (ej. 0, 1, 2...)
        },
        onException: (error: any) => {
          console.log('ERROR DE EXCEPCION EN SDK: ', error);
        },
        onResult: (temp: any) => {
          // Cuando el algoritmo del SDK termina con éxito, despacha el valor final al callback
          this.SDK.unRegisterBTListener();
          callback(temp);
        },
      });

      // Envía la orden física/lógica al motor para comenzar la captura de temperatura
      this.SDK.startDetect(Detection.BT);
    } else {
      console.log('Error: SDK o registerBTListener no están definidos');
    }
  }

  /**
   * Inicia el proceso de medición de oxígeno en sangre (SpO2) y frecuencia cardíaca.
   * Configura el ciclo de vida del oxímetro, controlando la detección del dedo en el hardware,
   * los tiempos mínimos de estabilización (30 segundos) y la recolección de los datos finales.
   *
   * Distingue dos avisos que antes compartían callback:
   * - `onDedo`: el sensor detecta o pierde el dedo. La medición SIGUE en curso
   *   (el SDK puede avisar de "sin dedo" nada más empezar, antes de apoyarlo).
   * - `onInterrumpida`: el monitor ha terminado antes de los 30 s mínimos,
   *   así que no hay resultado válido.
   *
   * @param callback - Función que recibe los valores finales validados: (spo2, hr).
   * @param onDedo - (Opcional) Notifica si el dedo está o no sobre el sensor.
   * @param onEnd - (Opcional) La medición finaliza con éxito tras cumplir el tiempo.
   * @param onInterrumpida - (Opcional) La medición terminó antes de tiempo.
   */
  medicionOxigeno(
    callback: (spo2: number, hr: number) => void,
    onDedo?: (tocando: boolean) => void,
    onEnd?: () => void,
    onInterrumpida?: () => void,
  ) {
    let tiempoInicio = Date.now();
    this.cancelado = false;
    this.medicionOXFinalizando = false; // Se reinicia al empezar cada medición nueva

    // Guardamos el contexto para que onModeChange (registrado en escanearConectar)
    // pueda usarlo como respaldo si onProcess nunca avisa del final
    this.oxigenoActivo = true;
    this.oxigenoTiempoInicio = tiempoInicio;
    this.oxigenoOnEnd = onEnd ?? null;
    this.oxigenoOnInterrumpida = onInterrumpida ?? null;

    if (this.SDK && this.SDK.registerOXListener) {
      this.SDK.registerOXListener({
        onProcess: (process: any) => {
          // Control único: si ya cerramos esta medición, ignoramos cualquier
          // aviso posterior, venga una vez o se repita varias veces
          if (this.medicionOXFinalizando) return;

          if (process === 0) {
            tiempoInicio = Date.now();
            this.oxigenoTiempoInicio = tiempoInicio;
          }

          if (process === 5) {
            if (this.cancelado) {
              this.medicionOXFinalizando = true;
              this.oxigenoActivo = false;
              this.cancelado = false;
              this.SDK.stopDetect('Blood Oxygen');
              return;
            }

            const segundosTranscurridos = (Date.now() - tiempoInicio) / 1000;

            this.medicionOXFinalizando = true;
            this.oxigenoActivo = false;

            console.log(
              `[OX] Fin por onProcess(5) a los ${segundosTranscurridos.toFixed(1)} s`,
            );
            this.SDK.unRegisterOXListener();
            if (segundosTranscurridos >= 30) {
              if (onEnd) onEnd();
            } else {
              if (onInterrumpida) onInterrumpida();
            }
          }
        },
        onException: (error: any) => {
          console.log('[SDK-OX] Excepción en oxímetro:', error);
        },
        onRawResult: (red: any, ir: any) => {},
        onFinger: (isTouch: boolean) => {
          // Igual que en ECG: si ya cerramos, no reaccionamos a más avisos
          if (this.medicionOXFinalizando) return;
          console.log('[OX] Dedo sobre el sensor:', isTouch);
          if (onDedo) onDedo(isTouch);
        },
        onResult: (spo2: any, hr: any) => {
          callback(Number(spo2), Number(hr));
        },
      });

      this.SDK.startDetect('Blood Oxygen');
    } else {
      console.log('Error: SDK o registerOXListener no están definidos');
    }
  }

  /**
   * Consulta el nivel de batería y el estado de energía del monitor de salud.
   * Registra los escuchadores (listeners) para monitorizar el porcentaje actual,
   * la notificación de carga completa y los cambios en el estado de alimentación (cargando/descargando).
   *
   * @param onNivel - Callback que recibe el porcentaje de batería actual (valor numérico de 0 a 100).
   * @param onCargaCompleta - (Opcional) Callback que se ejecuta cuando el hardware notifica una carga al 100%.
   * @param onCargando - (Opcional) Callback que se activa al conectar o desconectar el dispositivo de la corriente.
   */
  medicionBateria(
    onNivel: (nivel: number) => void,
    onCargaCompleta?: () => void,
    onCargando?: (cargando: boolean) => void,
  ) {
    if (this.SDK && this.SDK.registerBatteryListener) {
      this.SDK.registerBatteryListener({
        onProcess: (process: any) => {},
        onException: (error: any) => {
          console.log('[BATTERY] Error:', error);
        },
        onPowerResult: (data: any) => {
          // El SDK devuelve el porcentaje de energía remanente (escala 0 - 100)
          this.SDK.unRegisterBatteryListener();
          onNivel(Number(data));
        },
        onPowerFull: () => {
          // Evento de control disparado de forma asíncrona cuando llega al tope de carga
          if (onCargaCompleta) onCargaCompleta();
        },
        onPowerChange: (cargando: boolean) => {
          // Notifica si el cable de alimentación ha sido conectado o retirado
          if (onCargando) onCargando(cargando);
        },
      });

      // Envía la señal al hardware para leer los registros del estado de energía
      this.SDK.startDetect('Battery');
    } else {
      console.log('Error: SDK o registerBatteryListener no están definidos');
    }
  }

  /**
   * Cancela inmediatamente cualquier proceso de medición activo en el SDK.
   * Detiene la captura de datos en ejecución y elimina el registro de los escuchadores
   * (listeners) de oxígeno y presión arterial para liberar los recursos de comunicación.
   */
  async cancelarMedicion(tipo: 'OX' | 'BP' | 'BG' | 'BT' | 'ECG' | 'BATTERY') {
    if (this.SDK && this.SDK.stopDetect) {
      this.cancelado = true;
      this.SDK.stopDetect(Detection[tipo]);
      this.SDK.unRegisterOXListener();
      this.SDK.unRegisterBPListener();
      this.SDK.unRegisterECGListener();

      if (this.dispositivoConectado) {
        try {
          const comandoParada = new Uint8Array([
            0x01, 0x01, 0x00, 0x04, 0x04, 0x00, 0x01, 0x1f, 0x0a, 0xff,
          ]);
          await BleClient.write(
            this.dispositivoConectado.deviceId,
            LINKTOP_UUIDS.SERVICE_HEALTH_DETECT,
            LINKTOP_UUIDS.CHARACTERISTIC_HEART_RATE_WRITE,
            new DataView(comandoParada.buffer),
          );
        } catch (error) {
          console.error('[SDK] Error al enviar comando de parada:', error);
        }
      }
    }
  }

  /**
   * Inicia el proceso de medición de la presión arterial (tensiómetro).
   * Configura los escuchadores del hardware para seguir el inflado/desinflado del manguito,
   * intercepta y traduce los códigos de error específicos del dispositivo físico,
   * y propaga los resultados consolidados de presión sistólica, diastólica y pulso.
   *
   * @param callback - Función de retorno que recibe los tres valores medidos: (sistolica, diastolica, pulso).
   * @param onError - (Opcional) Callback que recibe un string descriptivo y traducido en caso de fallo físico.
   * @param onEnd - (Opcional) Callback de finalización (definido para el ciclo de vida del componente).
   */
  medicionPresion(
    // TODO - queda probar esto (no se prueba porque hace mucho ruido)
    callback: (sistolica: number, diastolica: number, pulso: number) => void,
    onError?: (mensaje: string) => void,
    onEnd?: () => void,
  ) {
    if (this.SDK && this.SDK.registerBPListener) {
      this.SDK.registerBPListener({
        onProcess: (process: any) => {
          console.log('[BP] onProcess:', process);
        },
        onException: (error: any) => {
          console.log('[BP] Error:', error);

          // Mapeo y traducción de códigos hexadecimales emitidos nativamente por el hardware
          let mensaje = 'Error desconocido en la medición.';
          switch (error) {
            case 0x0007:
              mensaje = 'Fuga detectada sin carga. Revise el manguito.';
              break;
            case 0x0008:
              mensaje =
                'Fuga de aire detectada. Revise el circuito del manguito.';
              break;
            case 0x0009:
              mensaje = 'Movimiento detectado. Mantenga el brazo quieto.';
              break;
            case 0x0010:
              mensaje = 'Resultado inválido. Inténtelo de nuevo.';
              break;
            case 0x0011:
              mensaje = 'Datos inválidos. Inténtelo de nuevo.';
              break;
          }

          // Liberación obligatoria del listener para evitar fugas de memoria o bloqueos en el próximo intento
          this.SDK.unRegisterBPListener();
          if (onError) onError(mensaje);
        },
        onResult: (result: any) => {
          console.log('[BP] Resultado:', result);

          // El SDK destruye la escucha automáticamente o requiere liberar el canal al terminar
          this.SDK.unRegisterBPListener();

          // Mapeo del objeto resultante del algoritmo del hardware:
          // result.ps -> Presión Sistólica (Máxima)
          // result.pd -> Presión Diastólica (Mínima)
          // result.hr -> Frecuencia Cardíaca (Pulso)
          callback(Number(result.ps), Number(result.pd), Number(result.hr));
        },
      });

      // Envía el comando de inicio para activar el inflador del manguito de presión
      this.SDK.startDetect('Blood Pressure');
    } else {
      console.log('Error: SDK o registerBPListener no están definidos');
    }
  }

  // FIXME - Se intentó integrar NeuroSky (algoritmo linktop) para calcular HR, HRV, ánimo y
  // frecuencia respiratoria a partir de la onda del ECG, siguiendo el ejemplo del manual
  // y reconstruyendo nosotros mismos el parseo de bytes BLE crudos.
  // Resultado: el HR de NeuroSky fue inconsistente en pruebas repetidas. Se descarta NeuroSky
  // por falta de fiabilidad demostrada.

  // TODO - Si se consigue documentación oficial del fabricante sobre la frecuencia de
  // muestreo real del ADC y el formato exacto de "processBluetoothEcgData", reintentar
  // NeuroSky para poder ofrecer ánimo y frecuencia respiratoria (no calculados por el SDK nativo).

  /**
   * Inicia la medición de ECG (electrocardiograma).
   * Dibuja la onda en tiempo real a través de onFilterResult, y obtiene HR y HRV
   * del cálculo nativo del propio SDK (onResult), que usa marcas de tiempo reales
   * y no depende de ninguna frecuencia de muestreo asumida.
   *
   * @param onDato - Callback que recibe cada punto de la onda ECG en tiempo real (solo visual).
   * @param onFingerOff - (Opcional) Callback si el usuario levanta los dedos antes de tiempo.
   * @param onEnd - (Opcional) Callback cuando la medición completa con éxito.
   * @param onMetricas - (Opcional) Callback que recibe HR y HRV nativos del SDK.
   */
  medicionECG(
    onDato: (valor: number, muestra: number) => void,
    onFingerOff?: () => void,
    onEnd?: () => void,
    onMetricas?: (metricas: { hr: number; hrv: number }) => void,
    onDedoCambio?: (tocando: boolean) => void,
  ) {
    let tiempoInicio = 0;
    this.datosObtenidosECG = false;
    this.medicionECGFinalizando = false; // Se reinicia al empezar cada medición nueva

    if (this.SDK && this.SDK.registerECGListener) {
      this.SDK.registerECGListener({
        onProcess: (process: any) => {
          // Control único: si ya hemos cerrado esta medición, ignoramos cualquier
          // aviso posterior del SDK (venga una vez o se repita varias veces)
          if (this.medicionECGFinalizando) return;

          if (process === 0) {
            tiempoInicio = Date.now();
          }

          if (process === 5) {
            this.medicionECGFinalizando = true; // Cerramos aquí mismo, antes de hacer nada más

            if (this.cancelado) {
              this.cancelado = false;
              this.cancelarMedicion('ECG');
              return;
            }

            const segundosTranscurridos = (Date.now() - tiempoInicio) / 1000;
            this.cancelarMedicion('ECG');

            if (segundosTranscurridos >= 30) {
              if (onEnd) onEnd();
            } else {
              if (onFingerOff) onFingerOff();
            }
          }
        },
        onFilterResult: (valor: number, muestra: number) => {
          onDato(valor, muestra);
        },
        onFingerdetection: (detected: any) => {
          // Mismo control único aquí -- si ya cerramos, no repetimos nada
          if (this.medicionECGFinalizando) return;

          if (onDedoCambio) onDedoCambio(detected);

          const segundosDesdeInicio = (Date.now() - tiempoInicio) / 1000;

          if (!detected && segundosDesdeInicio > 3) {
            this.medicionECGFinalizando = true; // Cerramos aquí antes de hacer nada más
            this.cancelarMedicion('ECG');

            if (this.datosObtenidosECG) {
              if (onEnd) onEnd();
            } else {
              if (onFingerOff) onFingerOff();
            }
          }
        },
        onRawData: () => {},
        onException: () => {},
        onLeadOff: () => {},
        onResult: (resultado: any) => {
          this.datosObtenidosECG = true;
          if (onMetricas) {
            onMetricas({
              hr: resultado.hr,
              hrv: resultado.hrv,
            });
          }
        },
        onHR: () => {},
        onWave: () => {},
      });

      this.SDK.startDetect('Electrocardiogram');
    } else {
      console.log('Error: SDK o registerECGListener no están definidos');
    }
  }
}
