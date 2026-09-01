import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const indexSource = await readFile(new URL("./index.ts", import.meta.url), "utf8");

test("el arranque del servidor no importa ni invoca materialización de actividades recurrentes", () => {
  expect(indexSource).not.toContain("procesarActividadesRecurrentesProgramadas");
  expect(indexSource).not.toContain("[STARTUP]");
  expect(indexSource).not.toContain("Verificando actividades recurrentes pendientes al arrancar");
  expect(indexSource).not.toContain("setTimeout(async () =>");
});

test("dos reinicios no pueden introducir una ejecución de recurrencias por startup", () => {
  for (let reinicio = 0; reinicio < 2; reinicio += 1) {
    expect(indexSource).not.toMatch(/procesar(?:ActividadesRecurrentes|Recurrencias)Programadas/);
  }
});
