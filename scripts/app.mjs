import { MODULE_ID, PHASE, STATUS, PLAYER_ACTION } from './constants.mjs';
import { GameManager } from './game-manager.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BaldursBonesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'baldurs-bones-app',
    classes: ['baldurs-bones'],
    window: { title: "Baldur's Bones", resizable: true, icon: 'fas fa-dice' },
    position: { width: 660, height: 620 }
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
    const isTablePhase = state.phase === PHASE.PLAYING || state.phase === PHASE.INITIAL_ROLL || state.phase === PHASE.RESOLUTION;

    // Compute round-table positions for each player
    const count = state.players.length;
    const radius = count <= 3 ? 34 : count <= 5 ? 38 : 41;

    let availableActors = [];
    if (isGM && state.phase === PHASE.SETUP) {
      const existing = new Set(state.players.map(p => p.actorId));
      availableActors = game.actors.contents
        .filter(a => !existing.has(a.id))
        .map(a => ({ id: a.id, name: a.name, img: a.img }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    // Winner info for resolution
    let winnerName = null, winnerImg = null;
    if (state.phase === PHASE.RESOLUTION && state.winnerId && state.winnerId !== 'tie') {
      const wp = state.players.find(p => p.actorId === state.winnerId);
      if (wp) { winnerName = wp.name; winnerImg = wp.img; }
    }

    // Coin pile: one coin per player who anted, up to 10 visual coins
    const showCoins = state.phase !== PHASE.SETUP && state.pot > 0;
    const coinCount = showCoins ? Math.min(state.players.length * 2, 12) : 0;
    const coins = [];
    for (let i = 0; i < coinCount; i++) coins.push({ index: i });

    return {
      hasGame: true, isGM, state, isTablePhase,
      isSetup: state.phase === PHASE.SETUP,
      isInitialRoll: state.phase === PHASE.INITIAL_ROLL,
      isPlaying: state.phase === PHASE.PLAYING,
      isResolution: state.phase === PHASE.RESOLUTION,
      players: state.players.map((p, i) => {
        const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
        const posX = (50 + radius * Math.cos(angle)).toFixed(1);
        const posY = (50 + radius * Math.sin(angle)).toFixed(1);
        return {
          ...p,
          isCurrent: (state.phase === PHASE.PLAYING || state.phase === PHASE.INITIAL_ROLL) &&
                     state.players[state.currentPlayerIndex]?.actorId === p.actorId,
          isBust: p.status === STATUS.BUST,
          isStanding: p.status === STATUS.STANDING,
          isWinner: state.winnerId === p.actorId,
          isHost: p.actorId === state.hostActorId,
          hasRolled: p.dice.length > 0,
          diceValues: p.dice,
          posX, posY
        };
      }),
      playerCount: count,
      ante: state.ante, pot: state.pot,
      canAct, canCheat,
      currentPlayerName: currentPlayer?.name ?? '',
      currentActorId: currentPlayer?.actorId ?? '',
      currentIsNPC: currentPlayer?.isNPC ?? false,
      availableActors,
      roundLog: state.roundLog ?? [],
      winnerId: state.winnerId,
      winnerName, winnerImg,
      coins
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

    // Actor search filter
    const searchInput = html.querySelector('#bb-actor-search');
    const selectEl = html.querySelector('#bb-actor-select');
    if (searchInput && selectEl) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase();
        for (const opt of selectEl.options) {
          if (!opt.value) continue;
          opt.hidden = q.length > 0 && !opt.textContent.toLowerCase().includes(q);
        }
      });
    }

    // Initial roll
    html.querySelector('[data-action="initial-roll"]')?.addEventListener('click', () => {
      const actorId = html.querySelector('[data-action="initial-roll"]').dataset.actorId;
      GameManager.instance.submitInitialRoll(actorId);
    });

    // Playing: roll & stand
    html.querySelector('[data-action="roll"]')?.addEventListener('click', () => {
      const actorId = html.querySelector('[data-action="roll"]').dataset.actorId;
      GameManager.instance.submitAction(actorId, PLAYER_ACTION.ROLL);
    });
    html.querySelector('[data-action="stand"]')?.addEventListener('click', () => {
      const actorId = html.querySelector('[data-action="stand"]').dataset.actorId;
      GameManager.instance.submitAction(actorId, PLAYER_ACTION.STAND);
    });

    // Cheat
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

    // Resolution & forfeit
    html.querySelector('[data-action="play-again"]')?.addEventListener('click', () =>
      GameManager.instance.playAgain());
    html.querySelector('[data-action="end-game"]')?.addEventListener('click', () =>
      GameManager.instance.endGame());
    html.querySelector('[data-action="forfeit"]')?.addEventListener('click', () =>
      GameManager.instance.forfeitGame());

    const log = html.querySelector('.bb-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  close(options = {}) { GameManager.instance.app = null; return super.close(options); }
}
