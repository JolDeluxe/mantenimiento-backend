-- AlterTable
ALTER TABLE `usuario` ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `PasswordResetToken` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `usuarioId` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PasswordResetToken_token_key`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Tarea_estado_idx` ON `Tarea`(`estado`);

-- CreateIndex
CREATE INDEX `Tarea_createdAt_idx` ON `Tarea`(`createdAt`);

-- CreateIndex
CREATE INDEX `Tarea_titulo_idx` ON `Tarea`(`titulo`);

-- CreateIndex
CREATE INDEX `Tarea_tipo_idx` ON `Tarea`(`tipo`);

-- AddForeignKey
ALTER TABLE `PasswordResetToken` ADD CONSTRAINT `PasswordResetToken_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `tarea` RENAME INDEX `Tarea_creadorId_fkey` TO `Tarea_creadorId_idx`;

-- RenameIndex
ALTER TABLE `tarea` RENAME INDEX `Tarea_departamentoId_fkey` TO `Tarea_departamentoId_idx`;
