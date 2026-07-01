import "server-only";

import { compare, hash } from "bcryptjs";

export function hashPassword(password: string) {
  return hash(password, 10);
}

export function verifyPassword(password: string, passwordHash: string) {
  return compare(password, passwordHash);
}
