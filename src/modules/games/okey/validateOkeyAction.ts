import { OkeyAction } from './okey.actions';

export function validateOkeyAction(a: any): asserts a is OkeyAction {
  if (!a || typeof a !== 'object') {
    throw new Error('Invalid action payload');
  }

  if (typeof a.type !== 'string') {
    throw new Error('Action type missing');
  }

  switch (a.type) {
    case 'DRAW_DECK':
    case 'DRAW_DISCARD':
    case 'DECLARE_CIFT':
    case 'DECLARE_WIN':
      return;

    case 'DISCARD':
      if (typeof a.tileId !== 'string' || !a.tileId.trim()) {
        throw new Error('Invalid DISCARD action');
      }
      return;

    case 'FORCE_FINISH':
      if (
        a.winnerSeat !== null &&
        (typeof a.winnerSeat !== 'number' ||
          !Number.isInteger(a.winnerSeat) ||
          a.winnerSeat < 0 ||
          a.winnerSeat > 3)
      ) {
        throw new Error('Invalid FORCE_FINISH action');
      }
      return;

    default:
      throw new Error(`Unknown action type: ${a.type}`);
  }
}
