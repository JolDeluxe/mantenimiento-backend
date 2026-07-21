ALTER TABLE `Tarea` ADD COLUMN `incidenteId` VARCHAR(80) NULL, ADD COLUMN `fechaParoProduccion` DATETIME(3) NULL;
CREATE INDEX `Tarea_incidenteId_idx` ON `Tarea`(`incidenteId`);
CREATE INDEX `Tarea_fechaParoProduccion_idx` ON `Tarea`(`fechaParoProduccion`);
