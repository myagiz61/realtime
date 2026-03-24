import { SpadesAction, SpadesState } from './spades.types';

export function validateSpadesAction(
  state: SpadesState,
  seat: number,
  action: SpadesAction,
) {
  if (!action || typeof action !== 'object') {
    throw new Error('Invalid action');
  }

  const player = state.players[seat];

  if (!player) {
    throw new Error('Player not found');
  }

  if (action.type === 'BID') {
    if (state.phase !== 'BIDDING') {
      throw new Error('Not bidding phase');
    }

    if (!Number.isInteger(action.bid)) {
      throw new Error('Bid must be integer');
    }

    const bidType = action.bidType ?? 'NORMAL';

    if (player.bid !== null) {
      throw new Error('Player already bid');
    }

    // NORMAL BID
    if (bidType === 'NORMAL') {
      if (action.bid < 1 || action.bid > 13) {
        throw new Error('Normal bid must be 1-13');
      }
      return;
    }

    // NIL BID
    if (bidType === 'NIL') {
      if (action.bid !== 0) {
        throw new Error('Nil bid must be 0');
      }
      return;
    }

    // BLIND NIL
    if (bidType === 'BLIND_NIL') {
      if (action.bid !== 0) {
        throw new Error('Blind nil bid must be 0');
      }
      return;
    }

    throw new Error('Invalid bid type');
  }

  if (action.type === 'PLAY_CARD') {
    if (state.phase !== 'PLAYING') {
      throw new Error('Not playing phase');
    }

    const card = player.hand.find((c) => c.id === action.cardId);

    if (!card) {
      throw new Error('Card not in hand');
    }

    const trick = state.currentTrick;

    if (trick && trick.leadSuit) {
      const leadSuit = trick.leadSuit;

      const hasLeadSuit = player.hand.some((c) => c.suit === leadSuit);

      if (hasLeadSuit && card.suit !== leadSuit) {
        throw new Error('Must follow lead suit');
      }
    }

    if (!state.spadesBroken) {
      const trickEmpty =
        !state.currentTrick || state.currentTrick.plays.length === 0;

      if (trickEmpty && card.suit === 'SPADES') {
        const hasOtherSuit = player.hand.some((c) => c.suit !== 'SPADES');

        if (hasOtherSuit) {
          throw new Error('Spades not broken yet');
        }
      }
    }

    return;
  }

  if (action.type === 'START_NEXT_ROUND') {
    if (state.phase !== 'ROUND_FINISHED') {
      throw new Error('Round not finished');
    }
    return;
  }

  if (action.type === 'FORCE_FINISH') {
    return;
  }

  throw new Error('Unsupported action');
}
