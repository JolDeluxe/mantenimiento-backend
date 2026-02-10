-- AlterTable
ALTER TABLE `pushsubscription` ADD COLUMN `failureCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lastSuccess` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `NotificacionLog` (
    `id` VARCHAR(191) NOT NULL,
    `usuarioId` INTEGER NOT NULL,
    `titulo` VARCHAR(191) NOT NULL,
    `cuerpo` TEXT NOT NULL,
    `dispositivosObjetivo` INTEGER NOT NULL,
    `enviadosExito` INTEGER NOT NULL,
    `fallidos` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NotificacionLog_usuarioId_idx`(`usuarioId`),
    INDEX `NotificacionLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `NotificacionLog` ADD CONSTRAINT `NotificacionLog_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
