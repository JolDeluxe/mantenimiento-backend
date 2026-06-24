/*
  Warnings:

  - You are about to alter the column `criticidad` on the `maquina` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(7))` to `VarChar(10)`.
  - You are about to alter the column `estado` on the `maquina` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(9))` to `VarChar(50)`.
  - You are about to alter the column `clasificacion` on the `tarea` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(12))` to `Enum(EnumId(4))`.

*/
-- AlterTable
ALTER TABLE `historialtarea` MODIFY `estadoAnterior` ENUM('PENDIENTE', 'ASIGNADA', 'EN_PROGRESO', 'EN_PAUSA', 'RECHAZADO', 'RESUELTO', 'CERRADO', 'CANCELADA') NULL,
    MODIFY `estadoNuevo` ENUM('PENDIENTE', 'ASIGNADA', 'EN_PROGRESO', 'EN_PAUSA', 'RECHAZADO', 'RESUELTO', 'CERRADO', 'CANCELADA') NULL;

-- AlterTable
ALTER TABLE `intervalotiempo` MODIFY `estado` ENUM('PENDIENTE', 'ASIGNADA', 'EN_PROGRESO', 'EN_PAUSA', 'RECHAZADO', 'RESUELTO', 'CERRADO', 'CANCELADA') NOT NULL;

-- AlterTable
ALTER TABLE `maquina` MODIFY `criticidad` VARCHAR(10) NULL DEFAULT 'C',
    MODIFY `estado` VARCHAR(50) NOT NULL DEFAULT 'OPERATIVA';

-- AlterTable
ALTER TABLE `tarea` MODIFY `estado` ENUM('PENDIENTE', 'ASIGNADA', 'EN_PROGRESO', 'EN_PAUSA', 'RECHAZADO', 'RESUELTO', 'CERRADO', 'CANCELADA') NOT NULL DEFAULT 'PENDIENTE',
    MODIFY `clasificacion` ENUM('PREVENTIVO', 'CORRECTIVO', 'AUTONOMO') NULL;
