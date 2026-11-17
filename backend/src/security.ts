import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.js';
import { config } from './config.js';
import { uuid } from './contracts.js';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const secret = () => randomBytes(32).toString('hex');
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, value] = stored.split(':');
  if (!salt || !value) return false;
  const expected = Buffer.from(value, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export interface AuthRequest extends Request {
  userId?: string;
  sessionId?: string;
  agentDeviceId?: string;
}
export function requireOrigin(req: Request, _res: Response, next: NextFunction) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== config.WEB_ORIGIN)
    throw new ApiError(403, 'Untrusted request origin');
  next();
}
export async function userAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const token: unknown = req.cookies?.up_session;
  if (typeof token !== 'string' || token.length !== 64)
    throw new ApiError(401, 'Sign in to continue');
  const session = await db.session.findUnique({ where: { tokenHash: hash(token) } });
  if (!session || session.expiresAt < new Date())
    throw new ApiError(401, 'Session expired. Sign in again.');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (
      req.get('origin') !== config.WEB_ORIGIN ||
      hash(req.get('x-csrf-token') ?? '') !== session.csrfHash
    )
      throw new ApiError(403, 'Invalid request confirmation');
  }
  req.userId = session.userId;
  req.sessionId = session.id;
  next();
}
export async function agentAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(req.get('authorization') ?? '');
  if (!match) throw new ApiError(401, 'Agent authentication required');
  const credential = await db.agentCredential.findUnique({
    where: { tokenHash: hash(match[1]) },
    include: { device: true },
  });
  if (
    !credential ||
    credential.revokedAt ||
    credential.device.revokedAt ||
    credential.expiresAt < new Date()
  )
    throw new ApiError(401, 'Agent credential expired or revoked; pair again');
  const timestamp = Number(req.get('x-agent-timestamp'));
  const nonce = uuid.safeParse(req.get('x-request-id'));
  if (!nonce.success || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 60000)
    throw new ApiError(403, 'Invalid or expired agent request');
  try {
    await db.agentNonce.create({ data: { credentialId: credential.id, nonce: nonce.data } });
  } catch (e) {
    if (typeof e === 'object' && e && 'code' in e && e.code === 'P2002')
      throw new ApiError(409, 'Replayed agent request');
    throw e;
  }
  req.agentDeviceId = credential.deviceId;
  next();
}
export async function ownedDevice(id: string, ownerId: string) {
  uuid.parse(id);
  const device = await db.device.findFirst({ where: { id, ownerId } });
  if (!device) throw new ApiError(404, 'Device not found');
  return device;
}
export function assertOnline(device: { lastSeen: Date; revokedAt: Date | null; health: string }) {
  if (device.revokedAt || Date.now() - device.lastSeen.getTime() > 60000)
    throw new ApiError(409, 'Agent is offline. Start the agent and try again.');
  if (device.health !== 'READY')
    throw new ApiError(409, 'Agent is not ready. Check Settings & Agent.');
}
