-- CreateTable
CREATE TABLE `ReglaRecurrenciaAjuste` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reglaRecurrenciaId` INTEGER NOT NULL,
    `fechaOriginal` DATETIME(3) NOT NULL,
    `periodoAnio` INTEGER NOT NULL,
    `periodoMes` INTEGER NOT NULL,
    `tipo` ENUM('MOVER', 'OMITIR') NOT NULL,
    `fechaNueva` DATETIME(3) NULL,
    `motivo` TEXT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RRA_regla_fechaOriginal_key`(`reglaRecurrenciaId`, `fechaOriginal`),
    INDEX `RRA_regla_periodo_idx`(`reglaRecurrenciaId`, `periodoAnio`, `periodoMes`),
    INDEX `RRA_tipo_activo_idx`(`tipo`, `activo`),
    INDEX `RRA_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `Tarea` ADD COLUMN `fechaProgramadaPreventiva` DATETIME(3) NULL;

-- AddForeignKey
ALTER TABLE `ReglaRecurrenciaAjuste` ADD CONSTRAINT `ReglaRecurrenciaAjuste_reglaRecurrenciaId_fkey` FOREIGN KEY (`reglaRecurrenciaId`) REFERENCES `ReglaRecurrencia`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReglaRecurrenciaAjuste` ADD CONSTRAINT `ReglaRecurrenciaAjuste_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
