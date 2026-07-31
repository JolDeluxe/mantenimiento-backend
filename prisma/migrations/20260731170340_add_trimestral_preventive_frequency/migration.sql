-- AlterTable
ALTER TABLE `reglarecurrencia` ADD COLUMN `fechaInicio` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `frecuencia` ENUM('SEMANAL', 'QUINCENAL', 'MENSUAL', 'TRIMESTRAL', 'PERSONALIZADA_DIAS') NOT NULL;

-- Update existing rules: set fechaInicio to proximaFechaEjecucion so their current cycle acts as anchor
UPDATE `reglarecurrencia` SET `fechaInicio` = `proximaFechaEjecucion`;
