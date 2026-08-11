-- Persistencia y auditoria de sesiones refresh.
ALTER TABLE `RefreshToken`
  ADD COLUMN `revokedAt` DATETIME(3) NULL,
  ADD COLUMN `lastUsedAt` DATETIME(3) NULL,
  ADD COLUMN `userAgent` VARCHAR(500) NULL,
  ADD COLUMN `ip` VARCHAR(64) NULL,
  MODIFY COLUMN `expiresAt` DATETIME(3) NULL;

-- Las sesiones activas y vigentes pasan a no expirar por inactividad.
-- Las revocadas o ya vencidas conservan su estado histórico.
UPDATE `RefreshToken`
SET `expiresAt` = NULL
WHERE `revoked` = false
  AND `expiresAt` IS NOT NULL
  AND `expiresAt` > NOW(3);

CREATE INDEX `RefreshToken_usuarioId_revoked_expiresAt_idx`
  ON `RefreshToken`(`usuarioId`, `revoked`, `expiresAt`);
