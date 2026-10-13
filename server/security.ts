import {
  randomBytes,
  createHash,
  scrypt,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
import type { DB } from "./db.js";
const derive = promisify(scrypt);
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString("base64url");
export const hash = (input: string) =>
  createHash("sha256").update(input).digest("hex");
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${((await derive(password, salt, 64)) as Buffer).toString("hex")}`;
}
export async function passwordMatches(password: string, encoded: string) {
  const [salt, expected] = encoded.split(":");
  const actual = (await derive(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    actual.length === expectedBuffer.length &&
    timingSafeEqual(actual, expectedBuffer)
  );
}
export const audit = async (
  db: DB,
  userId: string,
  action: string,
  target: string,
) => {
  await db.query(
    "INSERT INTO audit_log (id,user_id,action,target) VALUES ($1,$2,$3,$4)",
    [id(), userId, action, target],
  );
};
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
