import { TavlaEngine } from '../tavla/tavla.engine';
import { OkeyEngine } from '../okey/okey.engine';
import { Okey101Engine } from '../okey101/okey101.engine';
import { PistiEngine } from '../pisti/pisti.engine';
import { BlackjackEngine } from '../blackjack/blackjack.engine';
import { GameEngine } from '../games.types';
import { GameType } from '@prisma/client';
import { SpadesEngine } from '../spades/spades.engine';
import { TexasEngine } from '../texas/texas.engines';

const tavlaEngine = new TavlaEngine();
const okeyEngine = new OkeyEngine();
const okey101Engine = new Okey101Engine();
const pistiEngine = new PistiEngine();
const blackjackEngine = new BlackjackEngine();
const spadesEngine = new SpadesEngine();
const texasEngine = new TexasEngine();

export function getEngine(gameType: GameType): GameEngine {
  switch (gameType) {
    case 'TAVLA':
      return tavlaEngine;

    case 'OKEY':
      return okeyEngine;

    case 'OKEY101':
      return okey101Engine;

    case 'PISTI':
      return pistiEngine;

    case 'BLACKJACK':
      return blackjackEngine;

    case 'SPADES':
      return spadesEngine;
    case 'TEXAS_POKER':
      return texasEngine;

    default:
      throw new Error(`Engine not implemented for ${gameType}`);
  }
}
