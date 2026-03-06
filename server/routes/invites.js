import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

const router = Router();

router.use(requireAuth);

// ============================================================
// GET /api/invites
// List all PENDING invites for the authenticated user.
// Matched by email address so it works even before they've logged in.
// ============================================================
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('game_invites')
    .select('*, games(id, name, status)')
    .eq('invitee_email', req.user.email)
    .eq('status', 'PENDING')
    .order('invited_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  res.json(data || []);
});

// ============================================================
// POST /api/invites/:inviteId/accept
// Accept a pending invite.
// Creates a game_players row and marks the invite as ACCEPTED.
// ============================================================
router.post('/:inviteId/accept', async (req, res) => {
  const { inviteId } = req.params;

  // Fetch the invite, scoped to the caller's email for safety
  const { data: invite, error: fetchError } = await supabase
    .from('game_invites')
    .select('*')
    .eq('id', inviteId)
    .eq('invitee_email', req.user.email)
    .single();

  if (fetchError || !invite) return res.status(404).json({ error: 'Invite not found' });
  if (invite.status !== 'PENDING') {
    return res.status(400).json({ error: `Invite is already ${invite.status.toLowerCase()}` });
  }

  // Make sure the game hasn't moved past LOBBY
  const { data: game } = await supabase
    .from('games')
    .select('status')
    .eq('id', invite.game_id)
    .single();

  if (!game || game.status !== 'LOBBY') {
    return res.status(400).json({ error: 'This game is no longer accepting players' });
  }

  // Find the next available seat_order (always one more than the current highest)
  const { data: players } = await supabase
    .from('game_players')
    .select('seat_order')
    .eq('game_id', invite.game_id)
    .order('seat_order', { ascending: false })
    .limit(1);

  const nextSeat = players && players.length > 0 ? players[0].seat_order + 1 : 1;

  // Insert the player row
  const { error: playerError } = await supabase
    .from('game_players')
    .insert({ game_id: invite.game_id, user_id: req.user.id, seat_order: nextSeat });

  if (playerError) return res.status(500).json({ error: playerError.message });

  // Mark the invite as accepted, recording the user's ID
  const { error: updateError } = await supabase
    .from('game_invites')
    .update({
      status: 'ACCEPTED',
      invitee_id: req.user.id,
      responded_at: new Date().toISOString(),
    })
    .eq('id', inviteId);

  if (updateError) return res.status(500).json({ error: updateError.message });

  res.json({ success: true, gameId: invite.game_id });
});

// ============================================================
// POST /api/invites/:inviteId/decline
// Decline a pending invite.
// ============================================================
router.post('/:inviteId/decline', async (req, res) => {
  const { inviteId } = req.params;

  const { data: invite } = await supabase
    .from('game_invites')
    .select('invitee_email, status')
    .eq('id', inviteId)
    .single();

  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  if (invite.invitee_email !== req.user.email) return res.status(403).json({ error: 'Not your invite' });
  if (invite.status !== 'PENDING') {
    return res.status(400).json({ error: `Invite is already ${invite.status.toLowerCase()}` });
  }

  const { error } = await supabase
    .from('game_invites')
    .update({ status: 'DECLINED', responded_at: new Date().toISOString() })
    .eq('id', inviteId);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
});

export default router;
