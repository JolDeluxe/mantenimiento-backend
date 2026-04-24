import { Server } from "socket.io";
import type { Server as HttpServer } from "http";

let io: Server;

export const initSocket = (httpServer: HttpServer): Server => {
    io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
        },
    });

    io.on("connection", (socket) => {
        socket.on("join_room", (userId: number | string) => {
            socket.join(`user_${userId}`);
        });

        socket.on("join_global", () => {
            socket.join("global_updates");
        });

        socket.on("disconnect", () => {});
    });

    return io;
};

export const getIO = (): Server => {
    if (!io) throw new Error("Socket.io no ha sido inicializado.");
    return io;
};