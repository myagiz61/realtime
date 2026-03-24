export function validateTexasAction(action: any) {
  if (!action || typeof action !== 'object') {
    throw new Error('Invalid action');
  }

  const allowed = ['CHECK', 'FOLD', 'CALL', 'BET', 'RAISE', 'ALL_IN'];

  if (!allowed.includes(action.type)) {
    throw new Error(`Invalid Texas action: ${action.type}`);
  }
}
