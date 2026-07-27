CREATE TABLE `IdempotencyRecord` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(120) NOT NULL,
  `usuarioId` INTEGER NOT NULL,
  `method` VARCHAR(12) NOT NULL,
  `operation` VARCHAR(120) NOT NULL,
  `route` VARCHAR(255) NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `status` ENUM('PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PROCESSING',
  `responseStatus` INTEGER NULL,
  `responseBody` JSON NULL,
  `errorMessage` TEXT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `IdempotencyRecord_usuarioId_operation_key_key`(`usuarioId`, `operation`, `key`),
  INDEX `IdempotencyRecord_usuarioId_operation_idx`(`usuarioId`, `operation`),
  INDEX `IdempotencyRecord_expiresAt_idx`(`expiresAt`),
  INDEX `IdempotencyRecord_status_idx`(`status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `IdempotencyRecord`
  ADD CONSTRAINT `IdempotencyRecord_usuarioId_fkey`
  FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
