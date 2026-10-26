import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { Subject } from 'rxjs';

/**
 * Estructura de cada registro guardado para el anillo NexRing.
 * No distingue si el dato vino de una descarga masiva de históricos o de una
 * medición puntual pedida a mano (pulsación botón).
 * Todo se guarda igual, mezclado por fecha,y solo se diferencia por el campo "tipo".
 */
interface RegistroMedicionAnillo {
  id: string; // Identificador único de este registro
  tipo:
    | 'pulso'
    | 'oxigeno'
    | 'hrv'
    | 'temperatura'
    | 'bateria'
    | 'pasos'
    | 'sueno'
    | 'movimiento'
    | 'reposo'
    | 'ecg'
    | 'oxigenoNocturno'
    | 'respiracion'
    | 'inmersion';
  valores: Record<string, number>; // Los datos concretos de esa medición
  fecha: string; // Fecha y hora en formato ISO 8601 (UTC)
  sincronizado: boolean; // Para cuando tengamos sincronización con servidor
}

// Clave única bajo la que se guarda todo el historial del anillo
// Separada de la clave que usa el HistorialService del Health Monitor para que descargar
// miles de registros del anillo no obligue a releer/reescribir los datos del Health Monitor.
const CLAVE_ALMACEN = 'historial_anillo';

@Injectable({
  providedIn: 'root',
})
export class HistorialAnilloService {
  constructor() {}
  public datosActualizados$ = new Subject<void>();

  // Cadena de escrituras: evita que dos guardados simultáneos lean el mismo
  // estado y uno pise al otro
  private cola: Promise<unknown> = Promise.resolve();

  /** Ejecuta la tarea cuando terminen las anteriores. */
  private enCola<T>(tarea: () => Promise<T>): Promise<T> {
    const resultado = this.cola.then(tarea);
    this.cola = resultado.catch(() => undefined);
    return resultado;
  }

  /**
   * Guarda un nuevo registro de medición del anillo, sea cual sea su origen
   * (un solo registro de un histórico descargado, o una medición puntual
   * pedida a mano con un botón). Ambos casos usan este mismo método.
   *
   * @param tipo - Qué tipo de dato es (pulso, oxígeno, etc.)
   * @param valores - Los valores numéricos concretos de esa medición.
   * @param fecha - Fecha de la medición. Si no se indica, se usa el momento actual
   *                (útil para históricos, donde cada registro trae su propia fecha).
   */
  guardarMedicion(
    tipo: RegistroMedicionAnillo['tipo'],
    valores: Record<string, number>,
    fecha?: string,
  ): Promise<void> {
    return this.enCola(() => this.escribirMedicion(tipo, valores, fecha));
  }

  private async escribirMedicion(
    tipo: RegistroMedicionAnillo['tipo'],
    valores: Record<string, number>,
    fecha?: string,
  ): Promise<void> {
    try {
      const historialActual = await this.obtenerHistorialCompleto();

      const nuevoRegistro: RegistroMedicionAnillo = {
        id: crypto.randomUUID(),
        tipo,
        valores,
        fecha: fecha ?? new Date().toISOString(),
        sincronizado: false,
      };

      historialActual.push(nuevoRegistro);

      await Preferences.set({
        key: CLAVE_ALMACEN,
        value: JSON.stringify(historialActual),
      });
      this.datosActualizados$.next();
    } catch (error) {
      console.error('Error al guardar medición del anillo:', error);
    }
  }

  /**
   * Guarda varios registros de golpe. Pensado para la descarga masiva de
   * históricos...
   *
   * @returns true si el guardado salió bien, false si falló -- para que quien
   *          llame a esto pueda decidir con seguridad si es buen momento para
   *          borrar los datos originales (por ejemplo, del propio anillo).
   */
  guardarMedicionesEnLote(
    registros: {
      tipo: RegistroMedicionAnillo['tipo'];
      valores: Record<string, number>;
      fecha?: string;
    }[],
  ): Promise<boolean> {
    return this.enCola(() => this.escribirLote(registros));
  }

  private async escribirLote(
    registros: {
      tipo: RegistroMedicionAnillo['tipo'];
      valores: Record<string, number>;
      fecha?: string;
    }[],
  ): Promise<boolean> {
    try {
      const historialActual = await this.obtenerHistorialCompleto();

      const nuevosRegistros: RegistroMedicionAnillo[] = registros.map((r) => ({
        id: crypto.randomUUID(),
        tipo: r.tipo,
        valores: r.valores,
        fecha: r.fecha ?? new Date().toISOString(),
        sincronizado: false,
      }));

      const historialCompleto = [...historialActual, ...nuevosRegistros];

      await Preferences.set({
        key: CLAVE_ALMACEN,
        value: JSON.stringify(historialCompleto),
      });

      this.datosActualizados$.next();
      return true; // Guardado confirmado con éxito
    } catch (error) {
      console.error('Error al guardar lote de mediciones del anillo:', error);
      return false; // Algo falló -- quien llame a esto NO debe borrar nada
    }
  }

  /** Devuelve todos los registros guardados, de cualquier tipo, sin filtrar. */
  async obtenerHistorialCompleto(): Promise<RegistroMedicionAnillo[]> {
    try {
      const resultado = await Preferences.get({ key: CLAVE_ALMACEN });
      return resultado.value ? JSON.parse(resultado.value) : [];
    } catch (error) {
      console.error('Error al leer el historial del anillo:', error);
      return [];
    }
  }

  /**
   * Devuelve los registros dentro de un rango de fechas, agrupados por tipo.
   * Lee el almacén UNA sola vez, en lugar de una lectura por cada tipo; es lo
   * que usan las gráficas, que necesitan todos los tipos a la vez.
   *
   * @param desde - Fecha de inicio del rango (inclusive)
   * @param hasta - Fecha de fin del rango (inclusive). Por defecto, el momento actual.
   */
  async obtenerAgrupadoPorTipo(
    desde: Date,
    hasta: Date = new Date(),
  ): Promise<
    Partial<Record<RegistroMedicionAnillo['tipo'], RegistroMedicionAnillo[]>>
  > {
    const agrupado: Partial<
      Record<RegistroMedicionAnillo['tipo'], RegistroMedicionAnillo[]>
    > = {};
    for (const registro of await this.obtenerHistorialCompleto()) {
      const fecha = new Date(registro.fecha);
      if (fecha < desde || fecha > hasta) continue;
      (agrupado[registro.tipo] ??= []).push(registro);
    }
    return agrupado;
  }

}
