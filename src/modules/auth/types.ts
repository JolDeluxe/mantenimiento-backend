export interface TokenPayload {
  id: number;
  email: string | null;
  username: string;              
  rol: string;
  nombre: string;
  departamentoId: number | null; 
}