-- CreateTable
CREATE TABLE `FallaMaquina` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `maquinaId` INTEGER NOT NULL,
    `tareaId` INTEGER NULL,
    `estado` ENUM('PENDIENTE_DE_DIAGNOSTICO', 'ABIERTA', 'REHABILITADA', 'CERRADA', 'DESCARTADA') NOT NULL DEFAULT 'PENDIENTE_DE_DIAGNOSTICO',
    `calidadDato` ENUM('PROVISIONAL', 'CONFIRMADO', 'HISTORICO_ESTIMADO', 'DATO_INCOMPLETO') NOT NULL DEFAULT 'PROVISIONAL',
    `contabilizaComoFalla` BOOLEAN NOT NULL DEFAULT true,
    `impactoConfirmado` ENUM('NO_CONFIRMADO', 'SIN_PARO', 'PARO_PARCIAL', 'PARO_TOTAL') NOT NULL DEFAULT 'NO_CONFIRMADO',
    `fechaFallaReportada` DATETIME(3) NOT NULL,
    `fechaFallaConfirmada` DATETIME(3) NULL,
    `fechaRestauracion` DATETIME(3) NULL,
    `confirmadoPorId` INTEGER NULL,
    `snapshotCodigo` VARCHAR(50) NOT NULL,
    `snapshotPlanta` VARCHAR(100) NULL,
    `snapshotArea` VARCHAR(100) NULL,
    `snapshotProceso` VARCHAR(150) NOT NULL,
    `snapshotCriticidad` VARCHAR(10) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FallaMaquina_tareaId_key`(`tareaId`),
    INDEX `FallaMaquina_maquinaId_estado_idx`(`maquinaId`, `estado`),
    INDEX `FallaMaquina_fechaFallaConfirmada_idx`(`fechaFallaConfirmada`),
    INDEX `FallaMaquina_maquinaId_fechaFallaConfirmada_idx`(`maquinaId`, `fechaFallaConfirmada`),
    INDEX `FallaMaquina_calidadDato_contabilizaComoFalla_idx`(`calidadDato`, `contabilizaComoFalla`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IntervaloParoMaquina` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `maquinaId` INTEGER NOT NULL,
    `fallaId` INTEGER NULL,
    `tareaId` INTEGER NULL,
    `tipo` ENUM('PLANIFICADO', 'NO_PLANIFICADO') NOT NULL,
    `impacto` ENUM('NO_CONFIRMADO', 'SIN_PARO', 'PARO_PARCIAL', 'PARO_TOTAL') NOT NULL,
    `porcentajeAfectacion` INTEGER NULL,
    `calidadDato` ENUM('PROVISIONAL', 'CONFIRMADO', 'HISTORICO_ESTIMADO', 'DATO_INCOMPLETO') NOT NULL DEFAULT 'CONFIRMADO',
    `inicio` DATETIME(3) NOT NULL,
    `fin` DATETIME(3) NULL,
    `confirmadoPorId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IntervaloParoMaquina_maquinaId_inicio_idx`(`maquinaId`, `inicio`),
    INDEX `IntervaloParoMaquina_fallaId_idx`(`fallaId`),
    INDEX `IntervaloParoMaquina_tareaId_idx`(`tareaId`),
    INDEX `IntervaloParoMaquina_tipo_calidadDato_idx`(`tipo`, `calidadDato`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FallaMaquina` ADD CONSTRAINT `FallaMaquina_maquinaId_fkey` FOREIGN KEY (`maquinaId`) REFERENCES `Maquina`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FallaMaquina` ADD CONSTRAINT `FallaMaquina_tareaId_fkey` FOREIGN KEY (`tareaId`) REFERENCES `Tarea`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FallaMaquina` ADD CONSTRAINT `FallaMaquina_confirmadoPorId_fkey` FOREIGN KEY (`confirmadoPorId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntervaloParoMaquina` ADD CONSTRAINT `IntervaloParoMaquina_maquinaId_fkey` FOREIGN KEY (`maquinaId`) REFERENCES `Maquina`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntervaloParoMaquina` ADD CONSTRAINT `IntervaloParoMaquina_fallaId_fkey` FOREIGN KEY (`fallaId`) REFERENCES `FallaMaquina`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntervaloParoMaquina` ADD CONSTRAINT `IntervaloParoMaquina_tareaId_fkey` FOREIGN KEY (`tareaId`) REFERENCES `Tarea`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntervaloParoMaquina` ADD CONSTRAINT `IntervaloParoMaquina_confirmadoPorId_fkey` FOREIGN KEY (`confirmadoPorId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
