import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { EstadoIdempotencia, Prisma } from "@prisma/client";
import { prisma } from "../../db";

const IDEMPOTENCY_HEADER = "idempotency-key";
const IDEMPOTENCY_TTL_DAYS = 7;
const PROCESSING_TIMEOUT_MS = 2 * 60 * 1000;

type AuthenticatedRequest = Request & {
  user?: { id?: number };
};

const stableNormalize = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = stableNormalize((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
};

export const stablePayloadHash = (payload: unknown) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(stableNormalize(payload)))
    .digest("hex");

const getExpiresAt = () => {
  const date = new Date();
  date.setDate(date.getDate() + IDEMPOTENCY_TTL_DAYS);
  return date;
};

const getIdempotencyKey = (req: Request) => {
  const raw = req.header(IDEMPOTENCY_HEADER);
  if (!raw) return null;
  const key = raw.trim();
  return key.length > 0 && key.length <= 120 ? key : null;
};

const safeRequestPayload = (req: Request) => ({
  body: req.body ?? {},
  params: req.params ?? {},
  query: req.query ?? {},
});

const replayStoredResponse = (res: Response, responseStatus: number | null, responseBody: Prisma.JsonValue | null) =>
  res.status(responseStatus || 200).json(responseBody ?? {});

const isUniqueConstraint = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const isProcessingExpired = (updatedAt: Date) =>
  Date.now() - updatedAt.getTime() > PROCESSING_TIMEOUT_MS;

export const withIdempotency = (
  operation: string,
  route: string,
  handler: RequestHandler
): RequestHandler => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    const key = getIdempotencyKey(req);

    if (!userId || !key) {
      return handler(req, res, next);
    }

    const payloadHash = stablePayloadHash(safeRequestPayload(req));

    try {
      await prisma.idempotencyRecord.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });

      const claim = await prisma.idempotencyRecord
        .create({
          data: {
            key,
            usuarioId: userId,
            method: req.method.toUpperCase(),
            operation,
            route,
            payloadHash,
            status: EstadoIdempotencia.PROCESSING,
            expiresAt: getExpiresAt(),
          },
        })
        .then((record) => ({ record, wasCreated: true }))
        .catch(async (error) => {
          if (!isUniqueConstraint(error)) throw error;

          const existing = await prisma.idempotencyRecord.findUnique({
            where: { usuarioId_operation_key: { usuarioId: userId, operation, key } },
          });

          if (!existing) throw error;
          return { record: existing, wasCreated: false };
        });
      const { record, wasCreated } = claim;

      if (record.payloadHash !== payloadHash) {
        return res.status(409).json({
          error: "La solicitud no coincide con el intento original.",
          code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        });
      }

      if (record.status === EstadoIdempotencia.COMPLETED) {
        return replayStoredResponse(res, record.responseStatus, record.responseBody);
      }

      if (!wasCreated && record.status === EstadoIdempotencia.FAILED) {
        return res.status(409).json({
          error: "La solicitud requiere revisión antes de reintentarse.",
          code: "IDEMPOTENCY_REQUIRES_REVIEW",
        });
      }

      if (!wasCreated && record.status === EstadoIdempotencia.PROCESSING) {
        if (isProcessingExpired(record.updatedAt)) {
          await prisma.idempotencyRecord.update({
            where: { id: record.id },
            data: {
              status: EstadoIdempotencia.FAILED,
              errorMessage: "Processing timeout",
            },
          });
          return res.status(409).json({
            error: "La solicitud requiere revisión antes de reintentarse.",
            code: "IDEMPOTENCY_REQUIRES_REVIEW",
          });
        }

        return res.status(409).json({
          error: "La solicitud ya se está procesando.",
          code: "IDEMPOTENCY_IN_PROGRESS",
        });
      }

      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        const persistResponse = res.statusCode >= 200 && res.statusCode < 300
          ? prisma.idempotencyRecord.update({
            where: { id: record.id },
            data: {
              status: EstadoIdempotencia.COMPLETED,
              responseStatus: res.statusCode,
              responseBody: body as Prisma.InputJsonValue,
              errorMessage: null,
            },
          })
          : prisma.idempotencyRecord.delete({ where: { id: record.id } });

        persistResponse.then(() => originalJson(body)).catch(next);
        return res;
      }) as Response["json"];

      return handler(req, res, async (error?: unknown) => {
        if (error) {
          await prisma.idempotencyRecord.update({
            where: { id: record.id },
            data: {
              status: EstadoIdempotencia.FAILED,
              errorMessage: error instanceof Error ? error.message : "Error desconocido",
            },
          });
        }
        next(error);
      });
    } catch (error) {
      return next(error);
    }
  };
};
