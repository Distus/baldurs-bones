import { MODULE_ID, PHASE, STATUS, PLAYER_ACTION } from './constants.mjs';
import { GameManager } from './game-manager.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BaldursBonesApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: 'baldurs-bones-app',
    classes: ['baldurs-bones'],
    window: {
      title: "Baldur's Bones",
      resizable: true,
      icon: 'fas fa-dice'
    },
    position: {
      width: 660,
      height: 560
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/game.hbs`
    }
  };

  /* --------------------------------------------------
   * Context
   * -------------------------------------------------- */

  async _prepareContext(options) {
    const gm = GameManager.instance;
    const state = gm.state;
    if (!state) return { hasGame: false };

    const isGM = game.user.isGM;
    const currentPlayer = gm.getCurrentPlayer();
    const canAct = gm.canCurrentUserAct();

    // Build actor list for the add-player dropdown (GM only, setup)
    let availableActors = [];
    if (isGM && state.phase === PHASE.SETUP) {
      const existing = new Set(state.players.map(p => p.actorId));
      availableActors = game.actors.contents
        .filter(a => !existing.has(a.id))
        .map(a => ({ id: a.id, name: a.name, img: a.img }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    return {
      hasGame: true,
      isGM,
      state,
      phase: state.phase,
      isSetup: state.phase === PHASE.SETUP,
      isPlaying: state.phase === PHASE.PLAYING,
      isResolution: state.phase === PHASE.RESOLUTION,
      players: state.players.map(p => ({
        ...p,
        isCurrent: state.phase === PHASE.PLAYING &&
                   state.players[state.currentPlayerIndex]?.actorId === p.actorId,
        isBust: p.status === STATUS.BUST,
        isStanding: p.status === STATUS.STANDING,
        isWinner: state.winnerId === p.actorId,
        diceValues: p.dice
      })),
      ante: state.ante,
      pot: state.pot,
      canAct,
      currentPlayerName: currentPlayer?.name ?? '',
      currentActorId: currentPlayer?.actorId ?? '',
      currentIsNPC: currentPlayer?.isNPC ?? false,
      availableActors,
      roundLog: state.roundLog ?? [],
      winnerId: state.winnerId
    };
  }



  /* --------------------------------------------------
   * Event listeners
   * -------------------------------------------------- */

  _onRender(context, options) {
    const html = this.element;

    // Setup: add player
    html.querySelector('[data-action="add-player"]')?.addEventListener('click', () => {
      const select = html.querySelector('#bb-actor-select');
      if (select?.value) GameManager.instance.addPlayer(select.value);
    });

    // Setup: remove player
    html.querySelectorAll('[data-action="remove-player"]').forEach(btn => {
      btn.addEventListener('click', () => {
        GameManager.instance.removePlayer(btn.dataset.actorId);
      });
    });

    // Setup: ante input
    html.querySelector('#bb-ante-input')?.addEventListener('change', (e) => {
      GameManager.instance.setAnte(Number(e.target.value));
    });

    // Setup: start game
    html.querySelector('[data-action="start-game"]')?.addEventListener('click', () => {
      GameManager.instance.startGame();
    });

    // Playing: roll / stand
    html.querySelector('[data-action="roll"]')?.addEventListener('click', () => {
      const actorId = html.querySelector('[data-action="roll"]').dataset.actorId;
      GameManager.instance.submitAction(actorId, PLAYER_ACTION.ROLL);
    });
    html.querySelector('[data-action="stand"]')?.addEventListener('click', () => {
      const actorId = html.querySelector('[data-action="stand"]').dataset.actorId;
      GameManager.instance.submitAction(actorId, PLAYER_ACTION.STAND);
    });

    // Resolution: play again / end
    html.querySelector('[data-action="play-again"]')?.addEventListener('click', () => {
      GameManager.instance.playAgain();
    });
    html.querySelector('[data-action="end-game"]')?.addEventListener('click', () => {
      GameManager.instance.endGame();
    });

    // Auto-scroll the log
    const log = html.querySelector('.bb-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  /* --------------------------------------------------
   * Lifecycle
   * -------------------------------------------------- */

  close(options = {}) {
    GameManager.instance.app = null;
    return super.close(options);
  }
}
