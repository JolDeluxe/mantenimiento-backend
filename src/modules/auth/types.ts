export interface TokenPayload {
  id: number;
  username: string;
  email: string | null;
  rol: string;
  nombre: string;
  departamentoId: number | null;
}

export interface LoginResponse {
  status: "success";
  accessToken: string;
  refreshToken: string;
  user: {
    id: number;
    nombre: string;
    username: string;
    rol: string;
    departamentoId: number | null;
    email?: string; 
    mustChangePassword: boolean;
  };
}