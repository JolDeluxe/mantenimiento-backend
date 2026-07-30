import { expect, spyOn, test } from "bun:test";
import { notificarAsignacionTrasCommit } from "./06_materialize";

test("un fallo de notificación posterior al commit no propaga ni revierte la materialización", async () => {
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  await notificarAsignacionTrasCommit(
    { id: 1 } as never,
    [22],
    async () => { throw new Error("Servicio de notificaciones no disponible"); },
  );
  expect(errorSpy).toHaveBeenCalledTimes(1);
  errorSpy.mockRestore();
});
