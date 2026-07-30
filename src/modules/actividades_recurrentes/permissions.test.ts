import { describe, expect, test } from "bun:test";
import { Rol } from "@prisma/client";
import { authorize } from "../../middlewares/authorize";

const rolesGestion = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];

function ejecutar(rol: Rol) {
  let statusCode = 0;
  let nextCalled = false;
  const middleware = authorize(rolesGestion);
  middleware(
    { user: { rol } } as never,
    {
      status: (status: number) => {
        statusCode = status;
        return { json: () => undefined };
      },
    } as never,
    () => { nextCalled = true; },
  );
  return { statusCode, nextCalled };
}

describe("permisos de actividades recurrentes", () => {
  test("permite únicamente roles de gestión", () => {
    expect(ejecutar(Rol.SUPER_ADMIN).nextCalled).toBe(true);
    expect(ejecutar(Rol.JEFE_MTTO).nextCalled).toBe(true);
    expect(ejecutar(Rol.COORDINADOR_MTTO).nextCalled).toBe(true);
  });

  test("rechaza técnico y cliente interno", () => {
    expect(ejecutar(Rol.TECNICO).statusCode).toBe(403);
    expect(ejecutar(Rol.CLIENTE_INTERNO).statusCode).toBe(403);
  });
});
