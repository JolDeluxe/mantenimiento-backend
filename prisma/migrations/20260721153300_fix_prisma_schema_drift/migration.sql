-- AlterTable
ALTER TABLE `Tarea` ADD COLUMN `fechaVencimientoOriginal` DATETIME(3) NULL,
    ADD COLUMN `horaFinProgramada` DATETIME(3) NULL,
    ADD COLUMN `horaInicioProgramada` DATETIME(3) NULL,
    ADD COLUMN `refacciones` JSON NULL;

-- RenameIndex
ALTER TABLE `ReglaRecurrenciaAjuste` RENAME INDEX `RRA_createdById_idx` TO `ReglaRecurrenciaAjuste_createdById_idx`;

-- RenameIndex
ALTER TABLE `ReglaRecurrenciaAjuste` RENAME INDEX `RRA_regla_fechaOriginal_key` TO `ReglaRecurrenciaAjuste_reglaRecurrenciaId_fechaOriginal_key`;

-- RenameIndex
ALTER TABLE `ReglaRecurrenciaAjuste` RENAME INDEX `RRA_regla_periodo_idx` TO `ReglaRecurrenciaAjuste_reglaRecurrenciaId_periodoAnio_period_idx`;

-- RenameIndex
ALTER TABLE `ReglaRecurrenciaAjuste` RENAME INDEX `RRA_tipo_activo_idx` TO `ReglaRecurrenciaAjuste_tipo_activo_idx`;
