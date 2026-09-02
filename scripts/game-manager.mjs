import {
  MODULE_ID, SOCKET_NAME, BUST_THRESHOLD, STARTING_DICE,
  PHASE, STATUS, SOCKET_ACTION, PLAYER_ACTION, NPC_TALK
} from './constants.mjs';

/**
 * Manages the authoritative game state. Only the GM processes game logic;
 * all other clients receive state broadcasts and render accordingly.
 */
export class GameManager {
  /** @type {GameManager} */
  static #instance = null;

  /** @type {object|null} */
  #state = null;

  /** @type {BaldursBonesApp|null} */
  #app = null;

  /** @type {boolean} */
  #npcActing = false;

  /** @type {number|null} */
  #npcTimeout = null;

  constructor() {
    if (GameManager.#instance) return GameManager.#instance;
    GameManager.#instance = this;
  }

  static get instance() {
    if (!GameManager.#instance) new GameManager();
    return GameManager.#instance;
  }

  get state() { return this.#state; }
  get app() { return this.#app; }
  set app(val) { this.#app = val; }

  /* --------------------------------------------------
   * Utilities
   * -------------------------------------------------- */

  #delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  #pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  get #hasDSN() {
    return !!(game.modules.get('dice-so-nice')?.active && game.dice3d);
  }

  async #roll(formula) {
    const roll = await new Roll(formula).evaluate();
    if (this.#hasDSN) {
      try {
        await game.dice3d.showForRoll(roll, game.user, true);
      } catch (e) {
        console.warn(`${MODULE_ID} | Dice So Nice error:`, e);
      }
    }
    return roll;
  }

  /* --------------------------------------------------
   * Socket handling
   * -------------------------------------------------- */

  registerSocketListeners() {
    game.socket.on(SOCKET_NAME, (data) => this.#handleSocket(data));
  }

  #handleSocket(data) {
    switch (data.action) {
      case SOCKET_ACTION.UPDATE_STATE:
        this.#state = data.state;
        this.#renderApp();
        break;
      case SOCKET_ACTION.PLAYER_ACTION:
        if (game.user.isGM) {
          this.#processPlayerAction(data.actorId, data.playerAction, data.diceCount ?? 1);
        }
        break;
      case SOCKET_ACTION.OPEN_APP:
        this.#state = data.state;
        this.openApp();
        break;
      case SOCKET_ACTION.CLOSE_APP:
        this.#state = null;
        if (this.#app?.rendered) this.#app.close();
        break;
    }
  }

  #broadcast(action, extra = {}) {
    game.socket.emit(SOCKET_NAME, { action, ...extra });
  }

  /* --------------------------------------------------
   * Game lifecycle
   * -------------------------------------------------- */

  createGame() {
    this.#state = {
      id: foundry.utils.randomID(),
      phase: PHASE.SETUP,
      ante: 1,
      pot: 0,
      players: [],
      currentPlayerIndex: 0,
      winnerId: null,
      roundLog: []
    };
    this.openApp();
  }

  addPlayer(actorId) {
    if (!game.user.isGM || this.#state?.phase !== PHASE.SETUP) return;
    if (this.#state.players.find(p => p.actorId === actorId)) {
      ui.notifications.warn('That character is already in the game.');
      return;
    }
    const actor = game.actors.get(actorId);
    if (!actor) return;

    this.#state.players.push({
      actorId,
      name: actor.name,
      img: actor.img,
      isNPC: !actor.hasPlayerOwner,
      dice: [],
      total: 0,
      status: STATUS.ACTIVE
    });
    this.#broadcastState();
    this.#renderApp();
  }

  removePlayer(actorId) {
    if (!game.user.isGM || this.#state?.phase !== PHASE.SETUP) return;
    this.#state.players = this.#state.players.filter(p => p.actorId !== actorId);
    this.#broadcastState();
    this.#renderApp();
  }

  setAnte(amount) {
    if (!game.user.isGM || this.#state?.phase !== PHASE.SETUP) return;
    this.#state.ante = Math.max(0, Math.floor(amount));
    this.#broadcastState();
    this.#renderApp();
  }

  async startGame() {
    if (!game.user.isGM || this.#state?.phase !== PHASE.SETUP) return;
    if (this.#state.players.length < 2) {
      ui.notifications.warn('You need at least 2 players to start.');
      return;
    }

    for (const p of this.#state.players) {
      const actor = game.actors.get(p.actorId);
      if (!actor) continue;
      const gp = actor.system.currency?.gp ?? 0;
      if (gp < this.#state.ante) {
        ui.notifications.warn(`${p.name} cannot afford the ${this.#state.ante} gp ante.`);
        return;
      }
    }

    for (const p of this.#state.players) {
      const actor = game.actors.get(p.actorId);
      if (!actor) continue;
      await actor.update({
        'system.currency.gp': actor.system.currency.gp - this.#state.ante
      });
    }

    this.#state.pot = this.#state.ante * this.#state.players.length;
    this.#state.roundLog = [`Ante collected: ${this.#state.pot} gp in the pot.`];

    for (const p of this.#state.players) {
      const roll = await this.#roll(`${STARTING_DICE}d6`);
      p.dice = roll.terms[0].results.map(r => r.result);
      p.total = roll.total;
      if (p.total > BUST_THRESHOLD) {
        p.status = STATUS.BUST;
        this.#state.roundLog.push(`${p.name} rolled ${p.dice.join(', ')} = ${p.total} — BUST!`);
      } else {
        this.#state.roundLog.push(`${p.name} rolled ${p.dice.join(', ')} = ${p.total}`);
      }
    }

    this.#state.phase = PHASE.PLAYING;
    this.#state.currentPlayerIndex = this.#findNextActivePlayer(-1);

    if (this.#state.currentPlayerIndex === -1) {
      await this.#resolveGame();
      this.#broadcast(SOCKET_ACTION.OPEN_APP, { state: this.#state });
      this.#renderApp();
      return;
    }

    this.#broadcast(SOCKET_ACTION.OPEN_APP, { state: this.#state });
    this.#renderApp();
    this.#checkNPCAutoPlay();
  }

  /* --------------------------------------------------
   * Player actions
   * -------------------------------------------------- */

  submitAction(actorId, action, diceCount = 1) {
    if (game.user.isGM) {
      this.#processPlayerAction(actorId, action, diceCount);
    } else {
      this.#broadcast(SOCKET_ACTION.PLAYER_ACTION, {
        actorId,
        playerAction: action,
        diceCount
      });
    }
  }

  async #processPlayerAction(actorId, action, diceCount = 1) {
    if (!game.user.isGM || this.#state?.phase !== PHASE.PLAYING) return;

    const player = this.#state.players[this.#state.currentPlayerIndex];
    if (!player || player.actorId !== actorId) return;

    if (action === PLAYER_ACTION.ROLL) {
      diceCount = Math.max(1, Math.min(3, Math.floor(diceCount)));
      const formula = `${diceCount}d6`;
      const roll = await this.#roll(formula);
      const results = roll.terms[0].results.map(r => r.result);
      player.dice.push(...results);
      player.total += roll.total;

      const diceStr = results.join(', ');

      if (player.total > BUST_THRESHOLD) {
        player.status = STATUS.BUST;
        this.#state.roundLog.push(
          `${player.name} rolled ${diceStr} (${formula}) → ${player.total} — BUST!`
        );
        this.#advanceTurn();
      } else {
        this.#state.roundLog.push(
          `${player.name} rolled ${diceStr} (${formula}) → ${player.total}`
        );
      }
    } else if (action === PLAYER_ACTION.STAND) {
      player.status = STATUS.STANDING;
      this.#state.roundLog.push(`${player.name} stands at ${player.total}.`);
      this.#advanceTurn();
    }

    this.#broadcastState();
    this.#renderApp();
  }

  #advanceTurn() {
    const next = this.#findNextActivePlayer(this.#state.currentPlayerIndex);
    if (next === -1) {
      this.#resolveGame();
    } else {
      this.#state.currentPlayerIndex = next;
    }
  }

  #findNextActivePlayer(fromIndex) {
    const count = this.#state.players.length;
    for (let i = 1; i <= count; i++) {
      const idx = (fromIndex + i) % count;
      if (this.#state.players[idx].status === STATUS.ACTIVE) return idx;
    }
    return -1;
  }

  /* --------------------------------------------------
   * NPC Auto-Play
   * -------------------------------------------------- */

  #checkNPCAutoPlay() {
    if (!game.user.isGM || this.#state?.phase !== PHASE.PLAYING) return;
    if (this.#npcActing) return;

    const current = this.getCurrentPlayer();
    if (!current || !current.isNPC || current.status !== STATUS.ACTIVE) return;

    this.#npcActing = true;
    this.#clearNPCTimeout();

    // Safety: force-stand after 30s to prevent limbo
    this.#npcTimeout = setTimeout(() => {
      console.warn(`${MODULE_ID} | NPC turn timeout — forcing stand.`);
      this.#npcActing = false;
      if (this.#state?.phase === PHASE.PLAYING) {
        const cur = this.getCurrentPlayer();
        if (cur?.isNPC && cur.status === STATUS.ACTIVE) {
          cur.status = STATUS.STANDING;
          this.#state.roundLog.push(`${cur.name} takes too long and stands at ${cur.total}.`);
          this.#advanceTurn();
          this.#broadcastState();
          this.#renderApp();
          this.#checkNPCAutoPlay();
        }
      }
    }, 30000);

    this.#runNPCTurn(current)
      .catch(err => console.error(`${MODULE_ID} | NPC auto-play error:`, err))
      .finally(() => {
        this.#npcActing = false;
        this.#clearNPCTimeout();
      });
  }

  #clearNPCTimeout() {
    if (this.#npcTimeout) {
      clearTimeout(this.#npcTimeout);
      this.#npcTimeout = null;
    }
  }

  async #runNPCTurn(player) {
    while (player.status === STATUS.ACTIVE && this.#state?.phase === PHASE.PLAYING) {
      const current = this.getCurrentPlayer();
      if (!current || current.actorId !== player.actorId) break;

      await this.#delay(1000 + Math.random() * 800);

      // Guard after delay
      if (!this.#state || this.#state.phase !== PHASE.PLAYING) break;
      if (player.status !== STATUS.ACTIVE) break;

      const action = this.#npcDecide(player);

      if (action === PLAYER_ACTION.ROLL) {
        this.#postNPCChat(player, this.#pick(NPC_TALK.ROLL));
      } else {
        this.#postNPCChat(player, this.#pick(NPC_TALK.STAND));
      }

      await this.#delay(600);
      if (!this.#state || this.#state.phase !== PHASE.PLAYING) break;

      await this.#processPlayerAction(player.actorId, action, 1);

      if (player.status === STATUS.BUST) {
        await this.#delay(500);
        this.#postNPCChat(player, this.#pick(NPC_TALK.BUST));
      }

      if (action === PLAYER_ACTION.STAND || player.status === STATUS.BUST) break;
    }

    // Check if the next player is also an NPC
    if (this.#state?.phase === PHASE.PLAYING) {
      await this.#delay(400);
      this.#npcActing = false;
      this.#clearNPCTimeout();
      this.#checkNPCAutoPlay();
    }
  }

  /**
   * INT-based NPC decision logic.
   *
   * High INT → accurate risk perception → stands at smart thresholds.
   * Low INT  → underestimates bust risk → pushes luck more often.
   *
   * Never stands at 16 or below.
   */
  #npcDecide(player) {
    const total = player.total;
    if (total <= 16) return PLAYER_ACTION.ROLL;

    const actor = game.actors.get(player.actorId);
    const intScore = actor?.system?.abilities?.int?.value ?? 10;

    // Smart factor: 0.0 (INT 1) → 1.0 (INT 20)
    const smart = Math.max(0, Math.min(1, (intScore - 1) / 19));

    // Actual bust probability at this total:
    //   17 → 2/6 = 33%    18 → 3/6 = 50%
    //   19 → 4/6 = 67%    20 → 5/6 = 83%
    const bustChance = Math.max(0, Math.min(1, (total - 15) / 6));

    // Smart NPCs perceive risk accurately (1.0×).
    // Dumb NPCs underestimate it (down to 0.4×).
    const riskPerception = 0.4 + (smart * 0.6);
    let standChance = bustChance * riskPerception;

    // Add noise inversely proportional to INT
    const noise = (1 - smart) * 0.2;
    standChance += (Math.random() - 0.5) * 2 * noise;

    standChance = Math.max(0.05, Math.min(0.95, standChance));

    return Math.random() < standChance ? PLAYER_ACTION.STAND : PLAYER_ACTION.ROLL;
  }

  #postNPCChat(player, text) {
    const actor = game.actors.get(player.actorId);
    const speaker = actor
      ? ChatMessage.getSpeaker({ actor })
      : { alias: player.name };
    ChatMessage.create({
      content: `<em>${text}</em>`,
      speaker
    });
  }

  /* --------------------------------------------------
   * Game resolution
   * -------------------------------------------------- */

  async #resolveGame() {
    this.#state.phase = PHASE.RESOLUTION;
    const eligible = this.#state.players.filter(p => p.status !== STATUS.BUST);

    if (eligible.length === 0) {
      this.#state.roundLog.push('Everyone busted! The pot is lost to the house.');
      this.#state.winnerId = null;
      this.#postChatResult(`Everyone busted! The pot of ${this.#state.pot} gp is lost to the house.`);
      return;
    }

    eligible.sort((a, b) => b.total - a.total);
    const highScore = eligible[0].total;
    const winners = eligible.filter(p => p.total === highScore);

    if (winners.length === 1) {
      const winner = winners[0];
      this.#state.winnerId = winner.actorId;
      const actor = game.actors.get(winner.actorId);
      if (actor) {
        await actor.update({ 'system.currency.gp': actor.system.currency.gp + this.#state.pot });
      }
      this.#state.roundLog.push(`${winner.name} wins ${this.#state.pot} gp with a score of ${winner.total}!`);
      this.#postChatResult(`${winner.name} wins ${this.#state.pot} gp at Baldur's Bones with a score of ${winner.total}!`);
      if (winner.isNPC) {
        setTimeout(() => this.#postNPCChat(winner, this.#pick(NPC_TALK.WIN)), 800);
      }
    } else {
      const share = Math.floor(this.#state.pot / winners.length);
      const remainder = this.#state.pot - (share * winners.length);
      for (const w of winners) {
        const actor = game.actors.get(w.actorId);
        if (actor) {
          await actor.update({ 'system.currency.gp': actor.system.currency.gp + share });
        }
      }
      const names = winners.map(w => w.name).join(' and ');
      this.#state.winnerId = 'tie';
      this.#state.roundLog.push(`Tie! ${names} split the pot of ${this.#state.pot} gp (${share} gp each).`);
      if (remainder > 0) this.#state.roundLog.push(`${remainder} gp remainder goes to the house.`);
      this.#postChatResult(`${names} tie at ${highScore} and split the ${this.#state.pot} gp pot at Baldur's Bones!`);
    }
  }

  #postChatResult(content) {
    ChatMessage.create({
      content: `<div class="baldurs-bones-chat"><strong>🎲 Baldur's Bones</strong><br>${content}</div>`,
      speaker: { alias: "Baldur's Bones" }
    });
  }

  /* --------------------------------------------------
   * Play Again / End
   * -------------------------------------------------- */

  playAgain() {
    if (!game.user.isGM) return;
    this.#clearNPCTimeout();
    this.#npcActing = false;
    for (const p of this.#state.players) {
      p.dice = [];
      p.total = 0;
      p.status = STATUS.ACTIVE;
    }
    this.#state.phase = PHASE.SETUP;
    this.#state.pot = 0;
    this.#state.currentPlayerIndex = 0;
    this.#state.winnerId = null;
    this.#state.roundLog = [];
    this.#broadcastState();
    this.#renderApp();
  }

  endGame() {
    if (!game.user.isGM) return;
    this.#clearNPCTimeout();
    this.#npcActing = false;
    this.#state = null;
    this.#broadcast(SOCKET_ACTION.CLOSE_APP, {});
    if (this.#app?.rendered) this.#app.close();
  }

  /* --------------------------------------------------
   * Public helpers
   * -------------------------------------------------- */

  /**
   * Uses Foundry's native actor.isOwner for reliable permission checking
   * across all Foundry versions. Returns true for the owning player
   * and for the GM.
   */
  canCurrentUserAct() {
    if (!this.#state || this.#state.phase !== PHASE.PLAYING) return false;
    const current = this.#state.players[this.#state.currentPlayerIndex];
    if (!current || current.isNPC) return false;
    const actor = game.actors.get(current.actorId);
    if (!actor) return false;
    return actor.isOwner;
  }

  getCurrentPlayer() {
    if (!this.#state || this.#state.phase !== PHASE.PLAYING) return null;
    return this.#state.players[this.#state.currentPlayerIndex] ?? null;
  }

  openApp() {
    if (!this.#app) {
      import('./app.mjs').then(({ BaldursBonesApp }) => {
        this.#app = new BaldursBonesApp();
        this.#app.render(true);
      });
    } else {
      this.#app.render(true);
    }
  }

  #renderApp() {
    if (this.#app?.rendered) this.#app.render(true);
  }

  #broadcastState() {
    this.#broadcast(SOCKET_ACTION.UPDATE_STATE, { state: this.#state });
  }
}
