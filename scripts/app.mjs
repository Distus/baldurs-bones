import { MODULE_ID, PHASE, STATUS, PLAYER_ACTION } from './constants.mjs';
import { GameManager } from './game-manager.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BaldursBonesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'baldurs-bones-app',
    classes: ['baldurs-bones'],
    window: { title: "Baldur's Bones", resizable: true, icon: 'fas fa-dice' },
    position: { width: 660, height: 560 }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/game.hbs` } };

  async _prepareContext(options) {
    const gm = GameManager.instance;
    const state = gm.state;
    if (!state) return { hasGame: false };

    const isGM = game.user.isGM;
    const currentPlayer = gm.getCurrentPlayer();
    const canAct = gm.canCurrentUserAct();
    const canCheat = canAct && state.phase === PHASE.PLAYING && gm.getCheatEligibility() !== null;

    let availableActors = [];
    if (isGM && state.phase === PHASE.SETUP) {
      const existing = new Set(state.players.map(p => p.actorId));
      availableActors = game.actors.contents
        .filter(a => !existing.has(a.id))
        .map(a => ({ id: a.id, name: a.name, img: a.img }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    return {
      hasGame: true, isGM, state,
      isSetup: state.phase === PHASE.SETUP,
      isInitialRoll: state.phase === PHASE.INITIAL_ROLL,
      isPlaying: state.phase === PHASE.PLAYING,
      isResolution: state.phase === PHASE.RESOLUTION,
      players: state.players.map(p => ({
        ...p,
        isCurrent: (state.phase === PHASE.PLAYING || state.phase === PHASE.INITIAL_ROLL) &&
                   state.players[state.currentPlayerIndex]?.actorId === p.actorId,
        isBust: p.status === STATUS.BUST,
        isStanding: p.status === STATUS.STANDING,
        isWinner: state.winnerId === p.actorId,
        isHost: p.actorId === state.hostActorId,
        hasRolled: p.dice.length > 0,
        diceValues: p.dice
      })),
      ante: state.ante, pot: state.pot,
      canAct, canCheat,
      currentPlayerName: currentPlayer?.name ?? '',
      currentActorId: currentPlayer?.actorId ?? '',
      currentIsNPC: currentPlayer?.isNPC ?? false,
      availableActors,
      roundLog: state.roundLog ?? [],
      winnerId: state.winnerId
    };
  }

  _onRender(context, options) {
    const html = this.element;

    // Setup
    html.querySelector('[data-action="add-player"]')?.addEventListener('click', () => {
      const s = html.querySelector('#bb-actor-select');
      if (s?.value) GameManager.instance.addPlayer(s.value);
    });
    html.querySelectorAll('[data-action="remove-player"]').forEach(b =>
      b.addEventListener('click', () => GameManager.instance.removePlayer(b.dataset.actorId)));
    html.querySelector('#bb-ante-input')?.addEventListener('change', e =>
      GameManager.instance.setAnte(Number(e.target.value)));
    html.querySelector('[data-action="start-game"]')?.addEventListener('click', () =>
      GameManager.instance.startGame());

    // Initial roll
    html.querySelector('[data-action="initial-roll"]')?.addEventListener('click', () => {
      const actorId = html.querySelector('[data-action="initial-roll"]').dataset.actorId;
      GameManager.instance.submitInitialRoll(actorId);
    });

    // Playing: roll (always 1d6)
    html.querySelector('[data-action="roll"]')?.addEventListener('click', () => {
      const actorId = html.querySelector('[data-action="roll"]').dataset.actorId;
      GameManager.instance.submitAction(actorId, PLAYER_ACTION.ROLL);
    });
    html.querySelector('[data-action="stand"]')?.addEventListener('click', () => {
      const actorId = html.querySelector('[data-action="stand"]').dataset.actorId;
      GameManager.instance.submitAction(actorId, PLAYER_ACTION.STAND);
    });

    // Cheat toggle
    html.querySelector('[data-action="cheat"]')?.addEventListener('click', () => {
      const n = html.querySelector('#bb-normal-actions');
      const p = html.querySelector('#bb-cheat-picker');
      if (n) n.style.display = 'none';
      if (p) p.style.display = '';
    });
    html.querySelector('[data-action="cancel-cheat"]')?.addEventListener('click', () => {
      const n = html.querySelector('#bb-normal-actions');
      const p = html.querySelector('#bb-cheat-picker');
      if (n) n.style.display = '';
      if (p) p.style.display = 'none';
    });
    html.querySelectorAll('[data-action="cheat-pick"]').forEach(b =>
      b.addEventListener('click', () => {
        GameManager.instance.submitCheat(b.dataset.actorId, parseInt(b.dataset.value));
        const n = html.querySelector('#bb-normal-actions');
        const p = html.querySelector('#bb-cheat-picker');
        if (n) n.style.display = '';
        if (p) p.style.display = 'none';
      }));

    // Resolution
    html.querySelector('[data-action="play-again"]')?.addEventListener('click', () =>
      GameManager.instance.playAgain());
    html.querySelector('[data-action="end-game"]')?.addEventListener('click', () =>
      GameManager.instance.endGame());

    const log = html.querySelector('.bb-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  close(options = {}) { GameManager.instance.app = null; return super.close(options); }
}
