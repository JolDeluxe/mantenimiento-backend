-- CreateTable
CREATE TABLE `Notificacion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuarioId` INTEGER NOT NULL,
    `tipo` ENUM('NUEVO_REPORTE', 'TAREA_ASIGNADA', 'TAREA_INICIADA', 'TAREA_PAUSADA', 'TAREA_RESUELTA', 'TAREA_CERRADA', 'TAREA_RECHAZADA', 'TAREA_CANCELADA', 'TAREA_MODIFICADA', 'TAREA_REASIGNADA', 'REVISION_PENDIENTE', 'EQUIPO_RECHAZO') NOT NULL,
    `titulo` VARCHAR(255) NOT NULL,
    `cuerpo` TEXT NOT NULL,
    `tareaId` INTEGER NULL,
    `leida` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notificacion_usuarioId_idx`(`usuarioId`),
    INDEX `Notificacion_usuarioId_leida_idx`(`usuarioId`, `leida`),
    INDEX `Notificacion_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Notificacion` ADD CONSTRAINT `Notificacion_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
