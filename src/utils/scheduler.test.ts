import { describe, expect, test } from "bun:test";
import { programarRecurrencias } from "./scheduler";

type RegistroCron = {
  expression: string;
  task: () => void | Promise<void>;
  options: { timezone: string };
};

describe("scheduler de recurrencias", () => {
  test("inicializar el scheduler no ejecuta inmediatamente el callback", () => {
    const registros: RegistroCron[] = [];
    let maquinaria = 0;
    let actividades = 0;

    programarRecurrencias(
      (expression, task, options) => {
        registros.push({ expression, task, options });
      },
      {
        procesarRecurrenciasProgramadas: async () => { maquinaria += 1; },
        procesarActividadesRecurrentesProgramadas: async () => { actividades += 1; },
      },
    );

    expect(registros).toHaveLength(1);
    expect(registros[0]?.expression).toBe("0 2 * * *");
    expect(registros[0]?.options.timezone).toBe("America/Mexico_City");
    expect(maquinaria).toBe(0);
    expect(actividades).toBe(0);
  });

  test("cuando llega el horario CRON ejecuta maquinaria y actividades recurrentes", async () => {
    let callback: (() => void | Promise<void>) | undefined;
    let maquinaria = 0;
    let actividades = 0;

    programarRecurrencias(
      (_expression, task) => { callback = task; },
      {
        procesarRecurrenciasProgramadas: async () => { maquinaria += 1; },
        procesarActividadesRecurrentesProgramadas: async () => { actividades += 1; },
      },
    );

    expect(callback).toBeDefined();
    await callback?.();
    expect(maquinaria).toBe(1);
    expect(actividades).toBe(1);
  });

  test("dos inicializaciones consecutivas no ejecutan materialización por arranque", () => {
    let materializaciones = 0;
    const schedule = (_expression: string, _task: () => void | Promise<void>) => undefined;
    const handlers = {
      procesarRecurrenciasProgramadas: async () => { materializaciones += 1; },
      procesarActividadesRecurrentesProgramadas: async () => { materializaciones += 1; },
    };

    programarRecurrencias(schedule, handlers);
    programarRecurrencias(schedule, handlers);

    expect(materializaciones).toBe(0);
  });
});
