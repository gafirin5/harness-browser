import { Router } from 'express';
import { agentResultSchema } from '@orca/shared';
import { findAgentByToken } from '../agents/service.js';
import { AppError } from '../../lib/errors.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { parseWith } from '../../lib/validate.js';
import { applyAgentResult } from '../tasks/service.js';
import { asyncHandler } from '../../auth/middleware.js';

export const agentApiRouter = Router();

agentApiRouter.post(
  '/tasks/:code/result',
  asyncHandler(async (req, res) => {
    const header = req.get('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match?.[1]) {
      throw new AppError(401, 'UNAUTHORIZED', 'Token agent wajib dikirim.');
    }
    const agent = await findAgentByToken(match[1]);
    if (!agent) {
      throw new AppError(401, 'UNAUTHORIZED', 'Token agent tidak valid.');
    }

    rateLimit(`agent-callback:${agent.id}`, 120, 60_000);
    const body = parseWith(agentResultSchema, req.body);
    const code = String(req.params.code ?? '');
    const result = await applyAgentResult(agent.id, code, body);
    res.json({ data: result });
  })
);
