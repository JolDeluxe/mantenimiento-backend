-- CreateIndex
CREATE INDEX `Tarea_maquinaId_tipo_createdAt_idx` ON `Tarea`(`maquinaId`, `tipo`, `createdAt`);

-- CreateIndex
CREATE INDEX `Tarea_tipo_estado_createdAt_idx` ON `Tarea`(`tipo`, `estado`, `createdAt`);

-- CreateIndex
CREATE INDEX `Tarea_clasificacion_createdAt_idx` ON `Tarea`(`clasificacion`, `createdAt`);

-- CreateIndex
CREATE INDEX `Tarea_fechaVencimiento_estado_createdAt_idx` ON `Tarea`(`fechaVencimiento`, `estado`, `createdAt`);
