import { PistiAction } from './pisti.actions';
import { PistiState } from './pisti.types';

export function getLegalMoves(
  state: PistiState,
  playerId: string,
): PistiAction[] {
  const hand = state.hands[playerId] ?? [];
  return hand.map((_, index) => ({
    type: 'PLAY_CARD',
    cardIndex: index,
  }));
}

export function validateAction(
  state: PistiState,
  playerId: string,
  action: PistiAction,
): void {
  const currentPlayerId = state.players[state.turn];

  if (!currentPlayerId) {
    throw new Error('Invalid turn');
  }

  if (state.phase !== 'PLAYING') {
    throw new Error('Game is not in PLAYING phase');
  }

  if (currentPlayerId !== playerId) {
    throw new Error('Not your turn');
  }

  if (action.type !== 'PLAY_CARD') {
    throw new Error('Unsupported action');
  }

  if (!Number.isInteger(action.cardIndex)) {
    throw new Error('cardIndex must be an integer');
  }

  const legalMoves = getLegalMoves(state, playerId);
  const isLegal = legalMoves.some((m) => m.cardIndex === action.cardIndex);

  if (!isLegal) {
    throw new Error('Illegal move');
  }
}
