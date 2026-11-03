import { Router } from 'express';
import { COOKIE_NAME } from '@orca/shared';
import { requireAuth } from '../../auth/middleware.js';
import { isSessionValid } from '../../auth/session.js';
import { addClient, broadcastSummaryNow, clientCount, sendHeartbeat } from '../../realtime/hub.js';
import { getDashboardSummary } from './service.js';

export const dashboardRouter = Router();

dashboardRouter.get('/dashboard/summary', requireAuth, async (_req, res, next) => {
  try {
    res.json({ data: await getDashboardSummary() });
  } catch (error) {
    next(error);
  }
});

export const eventsRouter = Router();

eventsRouter.get('/events/stream', requireAuth, async (req, res) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');

  const userId = (res.locals.user as { id: number }).id;
  const remove = addClient(userId, res);

  try {
    const summary = await getDashboardSummary();
    res.write(`event: summary\ndata: ${JSON.stringify(summary)}\n\n`);
  } catch {
    // Abaikan; client akan memakai fallback polling.
  }

  const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME] ?? '';

  const heartbeat = setInterval(() => {
    sendHeartbeat();
    // Jika tidak ada klien, interval tetap hidup tetapi ringan.
    if (clientCount() === 0) {
      clearInterval(heartbeat);
    }
  }, 15_000);
  heartbeat.unref();

  // Tutup stream bila sesi logout/kedaluwarsa agar data tidak terus mengalir.
  // Validasi ini tidak memperbarui last_seen, sehingga membuka dashboard tidak
  // menghalangi expiry 8 jam tanpa aktivitas.
  const authCheck = setInterval(() => {
    void isSessionValid(token).then((valid) => {
      if (!valid) {
        clearInterval(authCheck);
        remove();
        res.end();
      }
    });
  }, 60_000);
  authCheck.unref();

  req.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(authCheck);
    remove();
    res.end();
  });

  req.on('error', () => {
    clearInterval(heartbeat);
    clearInterval(authCheck);
    remove();
  });

  // Pastikan data terbaru segera dikirim setelah koneksi.
  void broadcastSummaryNow();
});
