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

@Injectable({
  providedIn: 'root',
})
export class LinktopService {
  // Variables
  private dispositivoConectado: any = null;
  private SDK: any = null;
  private cancelado: boolean = false;
  private datosObtenidosECG: boolean = false;

  constructor() {
    this.SDK = (window as any).default;
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
            //console.log('[BLE-WRITE] Bytes:',Array.from(new Uint8Array(data)).map((b) => '0x' + b.toString(16).padStart(2, '0')).join(' '),);
            //console.log('[SDK] onDataPost recibe datos, longitud:',data?.length,);

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
    const Detection = {
      BT: 'Blood Temperature',
    };

    if (this.SDK && this.SDK.registerBTListener) {
      this.SDK.registerBTListener({
        onProcess: (process: any) => {
          // El SDK informa del progreso mediante un estado numérico de control (ej. 0, 1, 2...)
          console.log('SDK informa estado de temperatura: ', process);
        },
        onException: (error: any) => {
          console.log('ERROR DE EXCEPCION EN SDK: ', error);
        },
        onResult: (temp: any) => {
          console.log('[BT] onResult temperatura:', temp);
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
   * @param callback - Función que recibe los valores finales validados: (spo2, hr).
   * @param onFingerChange - (Opcional) Callback que notifica si el dedo entra en contacto con el sensor.
   * @param onEnd - (Opcional) Callback que se ejecuta cuando la medición finaliza con éxito tras cumplir el tiempo.
   */
  medicionOxigeno(
    callback: (spo2: number, hr: number) => void,
    onFingerChange?: (atendido: boolean) => void,
    onEnd?: () => void,
  ) {
    // Inicialización del cronómetro interno para validar el tiempo de exposición
    let tiempoInicio = Date.now();
    this.cancelado = false;

    if (this.SDK && this.SDK.registerOXListener) {
      this.SDK.registerOXListener({
        onProcess: (process: any) => {
          console.log('[SDK-OX] Estado numérico del proceso:', process);
          // if (process === 5 && onEnd) onEnd();

          if (process === 0) {
            // El estado 0 indica el reinicio del ciclo de lectura del sensor
            tiempoInicio = Date.now();
          }

          if (process === 5) {
            // Control de interrupción manual de la medición
            if (this.cancelado) {
              this.cancelado = false;
              this.SDK.stopDetect('OX');
              return;
            }

            const segundosTranscurridos = (Date.now() - tiempoInicio) / 1000;
            console.log(
              '[SDK-OX] Segundos transcurridos: ',
              segundosTranscurridos,
            );

            // Validación: El hardware exige un umbral de 30 segundos para una lectura estable
            if (segundosTranscurridos >= 30) {
              // Ha finalizado la medición con éxito
              this.SDK.unRegisterOXListener();
              if (onEnd) onEnd();
            } else {
              // El usuario ha quitado el dedo muy rápido antes de consolidar la muestra
              if (onFingerChange) {
                this.SDK.unRegisterOXListener();
                onFingerChange(false);
              }
            }
          }
        },
        onException: (error: any) => {
          console.log('[SDK-OX] Excepción en oxímetro:', error);
        },
        onRawResult: (red: any, ir: any) => {
          // console.log('[SDK-OX] Datos de onda en tiempo real recibidos');
        },
        onFinger: (isTouch: boolean) => {
          // Evento directo del hardware que detecta la presencia/ausencia del dedo
          // console.log(`[SDK-OX] Dedo detectado: ${isTouch}`);
          if (onFingerChange) {
            onFingerChange(isTouch);
          }
        },
        onResult: (spo2: any, hr: any) => {
          // Despacho de resultados finales tipados numéricamente hacia la aplicación
          // console.log(`[SDK-OX] ¡Lectura completada! SpO2: ${spo2}%, Pulso: ${hr} ppm`,);
          //this.SDK.unRegisterOXListener();
          callback(Number(spo2), Number(hr));
        },
      });

      // Ordenamos al motor arrancar el módulo de Oxígeno
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
    // TODO - Al estar conectado no dice la batería
    onNivel: (nivel: number) => void,
    onCargaCompleta?: () => void,
    onCargando?: (cargando: boolean) => void,
  ) {
    if (this.SDK && this.SDK.registerBatteryListener) {
      this.SDK.registerBatteryListener({
        onProcess: (process: any) => {
          console.log('[BATTERY] onProcess:', process);
        },
        onException: (error: any) => {
          console.log('[BATTERY] Error:', error);
        },
        // El SDK devuelve el porcentaje de energía remanente (escala 0 - 100)
        onPowerResult: (data: any) => {
          console.log('[BATTERY] Nivel:', data);
          onNivel(Number(data));
        },
        // Evento de control disparado de forma asíncrona cuando llega al tope de carga
        onPowerFull: () => {
          console.log('[BATTERY] Carga completa');
          if (onCargaCompleta) onCargaCompleta();
        },
        // Notifica si el cable de alimentación ha sido conectado o retirado
        onPowerChange: (cargando: boolean) => {
          console.log('[BATTERY] Batería cambiada, args', cargando);
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
  async cancelarMedicion() {
    if (this.SDK && this.SDK.stopDetect) {
      this.cancelado = true;
      this.SDK.stopDetect();
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
          console.log('[SDK] Comando de parada físico enviado al dispositivo');
        } catch (error) {
          console.error('[SDK] Error al enviar comando de parada:', error);
        }
      }

      console.log('[SDK] Medición cancelada por el usuario');
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

    if (this.SDK && this.SDK.registerECGListener) {
      this.SDK.registerECGListener({
        onProcess: (process: any) => {
          console.log('[ECG] onProcess:', process);

          if (process === 0) {
            tiempoInicio = Date.now();
          }

          if (process === 5) {
            if (this.cancelado) {
              this.cancelarMedicion();
              this.cancelado = false;
              return;
            }

            const segundosTranscurridos = (Date.now() - tiempoInicio) / 1000;
            console.log('[ECG] Segundos transcurridos:', segundosTranscurridos);

            // FIXME - Umbral de 30s heredado del patrón de oxígeno
            if (segundosTranscurridos >= 30) {
              this.cancelarMedicion();
              if (onEnd) onEnd();
            } else {
              this.cancelarMedicion();
              if (onFingerOff) onFingerOff();
            }
          }
        },
        // Dibuja la onda en tiempo real — callback descubierto por ingeniería inversa (Proxy),
        // no documentado con este nombre en el manual, pero confirmado funcionando visualmente.
        onFilterResult: (valor: number, muestra: number) => {
          onDato(valor, muestra);
        },
        onFingerdetection: (detected: any) => {
          console.log('[ECG] Dedo detectado:', detected);
          if (onDedoCambio) onDedoCambio(detected);

          // Contador para que no de error al iniciar medicion
          const segundosDesdeInicio = (Date.now() - tiempoInicio) / 1000;

          // Si se levanta el dedo paramos la medición
          if (!detected && segundosDesdeInicio > 3) {
            this.cancelarMedicion();
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
        // Cálculo nativo del propio SDK — usa tiempos reales, no depende de frecuencia
        // de muestreo asumida. Fuente fiable confirmada con pruebas repetidas (~53-54 ppm estable).
        onResult: (resultado: any) => {
          console.log('[ECG] onResult nativo del SDK:', resultado);
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
