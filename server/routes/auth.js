import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/auth/me
 * Returns the authenticated user's public profile from public.users.
 * Used by the client on app load to restore login state after a page refresh.
 */
router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

export default router;
