import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken"; 
import { env } from "../../../env";
import type { TokenPayload } from "../types";

export const generateAccessToken = (payload: TokenPayload): string => {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRES as any 
  };

  return jwt.sign(payload, env.JWT_SECRET, options);
};

export const generateRefreshToken = (payload: { id: number }): string => {
  const options: SignOptions = {
    expiresIn: env.JWT_REFRESH_EXPIRES as any
  };

  return jwt.sign(payload, env.JWT_SECRET, options);
};