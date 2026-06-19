import { Injectable } from '@angular/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { ExceptionCode } from '@capacitor/core';

/* DESDE AQUI SE GESTIONA LA CONEXION AL BLUETOOTH Y LA COMUNICACION CON EL 
DISPOSITIVO LINKTOP */

// Le avisamos a TypeScript de que el SDK de Linktop creará esta variable global en el navegador
declare var Engine: any;

// Registramos los parametros de conexión del bluetooth
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
  /* VARIABLES */
  private dispositivoConectado: any = null;
  private SDK: any = null; // Creamos la variable SDK para luego llamarla
  private cancelado: boolean = false; // Creamos esta variable por si el usuario cancela la medición

  constructor() {
    // Asignamos la variable SDK al arrancar
    this.SDK = (window as any).default;
  }

  /* INICIALIZACION BLUETOOTH */
  async inicializarBluetooth(): Promise<string> {
    try {
      // Inicializamos el hardware del bluetooth
      await BleClient.initialize();
      return 'Bluetooth listo. Esperando escaneo...';
    } catch (error) {
      return 'Error al iniciar el Bluetooth' + error;
    }
  }

  /* BUSQUEDA Y CONEXION */
  async escanearConectar(): Promise<string> {
    try {
      // Escaneamos en busca del dispositivo
      const device = await BleClient.requestDevice({
        services: [LINKTOP_UUIDS.SERVICE_HEALTH_DETECT],
      });
      this.dispositivoConectado = device;

      // Se realiza la conexión física con el hardware
      await BleClient.connect(device.deviceId);

      // Inicializamos el SDK aquí, ya con el Bluetooth conectado
      if (this.SDK && typeof this.SDK.initSdk === 'function') {
        // Objeto de configuración de retorno
        // Se tiene que crear para comunicar SDk - capacitor
        const appInterface = {
          onModeChange: (mode: any) => {
            console.log('[SDK] Modo cambiado: ', mode);
          },
          onException: (error: any) => {
            console.log('[SDK] Excepción global:', error);
          },
          onDataPost: async (data: any) => {
            // log para comprobar si llegan datos aquí
            console.log(
              '[SDK] onDataPost recibe datos, longitud:',
              data?.length,
            );
            // El algoritmo del SDK escupirá sus bytes automáticamente aquí.
            // Nosotros nos limitamos a inyectárselos al monitor por fff1 (WRITE)
            if (this.dispositivoConectado) {
              try {
                await BleClient.write(
                  this.dispositivoConectado.deviceId,
                  LINKTOP_UUIDS.SERVICE_HEALTH_DETECT,
                  LINKTOP_UUIDS.CHARACTERISTIC_HEART_RATE_WRITE, // fff1
                  new DataView(new Uint8Array(data).buffer),
                );
              } catch (error) {
                console.log('Error al transmitir comando del SDK:', error);
              }
            }
          },
        };

        // Ejecutamos la inicialización pasándole la interfaz que espera para no crashear
        this.SDK.initSdk(appInterface);
      }

      // Activamos la escucha de respuestas
      await BleClient.startNotifications(
        device.deviceId,
        LINKTOP_UUIDS.SERVICE_HEALTH_DETECT,
        LINKTOP_UUIDS.CHARACTERISTIC_HEART_RATE_MEASUREMENT,
        (value: DataView) => {
          // console.log('BLUETOOTH RECIBE BYTES: ', value.buffer.byteLength);
          if (this.SDK && this.SDK.pushRawData) {
            this.SDK.pushRawData(value.buffer);
          }
        },
      );

      return 'Conectado con éxito a ' + device.name;
    } catch (error) {
      return 'Error o escaneo cancelado: ' + error;
    }
  }

  /* OBTENER DISPOSITIVO */
  obtenerDispositivo() {
    return this.dispositivoConectado;
  }

  /* PEDIR DATOS TEMPERATURA */
  medicionTemperatura(callback: (resultado: any) => void) {
    const Detection = {
      BT: 'Blood Temperature',
    };

    if (this.SDK && this.SDK.registerBTListener) {
      this.SDK.registerBTListener({
        onProcess: (process: any) => {
          // El onProcess de temperatura solo informa del estado numérico (0, 1, 2...)
          console.log('SDK informa estado de temperatura: ', process);
        },
        onException: (error: any) => {
          console.log('ERROR DE EXCEPCION EN SDK: ', error);
        },
        onResult: (temp: any) => {
          console.log('[BT] onResult temperatura:', temp);
          // Cuando el algoritmo termina, nos devuelve el número final listo
          callback(temp);
        },
      });

      // Ordenamos al motor empezar a calcular la temperatura
      this.SDK.startDetect(Detection.BT);
    } else {
      console.log('Error: SDK o registerBTListener no están definidos');
    }
  }

  /* PEDIR DATOS DE OXIGENO EN SANGRE */
  medicionOxigeno(
    // Callbacks
    callback: (spo2: number, hr: number) => void,
    onFingerChange?: (atendido: boolean) => void,
    onEnd?: () => void,
  ) {
    // Iniciamos el contador
    let tiempoInicio = Date.now();

    if (this.SDK && this.SDK.registerOXListener) {
      this.SDK.registerOXListener({
        onProcess: (process: any) => {
          console.log('[SDK-OX] Estado numérico del proceso:', process);
          // if (process === 5 && onEnd) onEnd();
          if (process === 0) tiempoInicio = Date.now();
          if (process === 5) {
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
            if (segundosTranscurridos >= 30) {
              // Ha finalizado la medición con exito
              if (onEnd) onEnd();
            } else {
              // El usuario ha quitado el dedo muy rapido
              if (onFingerChange) onFingerChange(false); // FIXME - No funciona.
              // TODO - Hacer que cuando el usuario quite el dedo antes de tiempo salga un mensaje
              // TODO - Hacer que cuando el usuario quite el dedo antes de tiempo no muestre los datos
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
          //console.log(`[SDK-OX] Dedo detectado: ${isTouch}`);
          if (onFingerChange) {
            onFingerChange(isTouch);
          }
        },
        onResult: (spo2: any, hr: any) => {
          // console.log(`[SDK-OX] ¡Lectura completada! SpO2: ${spo2}%, Pulso: ${hr} ppm`,);
          callback(Number(spo2), Number(hr));
        },
      });

      // Ordenamos al motor arrancar el módulo de Oxígeno
      this.SDK.startDetect('Blood Oxygen');
    } else {
      console.log('Error: SDK o registerOXListener no están definidos');
    }
  }

  /* CONSULTAR NIVEL DE BATERÍA DEL DISPOSITIVO */
  medicionBateria(
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
        // Devuelve el nivel de batería entre 0 y 100
        onPowerResult: (data: any) => {
          console.log('[BATTERY] Nivel:', data);
          onNivel(Number(data));
        },
        // Se llama cuando el dispositivo está completamente cargado
        onPowerFull: () => {
          console.log('[BATTERY] Carga completa');
          if (onCargaCompleta) onCargaCompleta();
        },
        // Se llama cuando cambia el nivel de batería
        onPowerChange: (cargando: boolean) => {
          console.log('[BATTERY] Batería cambiada, args', cargando);
          if (onCargando) onCargando(cargando);
        },
      });

      this.SDK.startDetect('Battery');
    } else {
      console.log('Error: SDK o registerBatteryListener no están definidos');
    }
  }

  /* CANCELAR MEDICIÓN EN CURSO */
  cancelarMedicion() {
    // stopDetect para cualquier medición que esté en curso
    if (this.SDK && this.SDK.stopDetect) {
      this.cancelado = true;
      console.log('[SDK] Llamando stopDetect...');
      const resultado = this.SDK.stopDetect();
      console.log('[SDK] stopDetect resultado:', resultado);
      this.SDK.unRegisterOXListener();
      this.SDK.unRegisterBPListener();
      console.log('[SDK] Medición cancelada por el usuario');
    }
  }

  /* MEDIR PRESIÓN ARTERIAL */
  medicionPresion(
    // TODO - queda probar esto
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

          // Traducimos el código de error a un mensaje comprensible
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

          this.SDK.unRegisterBPListener();
          if (onError) onError(mensaje);
        },
        onResult: (result: any) => {
          console.log('[BP] Resultado:', result);
          // result.ps = presión sistólica (la alta)
          // result.pd = presión diastólica (la baja)
          // result.hr = frecuencia cardíaca
          this.SDK.unRegisterBPListener();
          callback(Number(result.ps), Number(result.pd), Number(result.hr));
        },
      });

      this.SDK.startDetect('Blood Pressure');
    } else {
      console.log('Error: SDK o registerBPListener no están definidos');
    }
  }
}
