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

  /** @type {boolean} - prevents overlapping NPC auto-play calls */
  #npcActing = false;

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

  /** Whether Dice So Nice is installed and active. */
  get #hasDSN() {
    return !!(game.modules.get('dice-so-nice')?.active && game.dice3d);
  }

  /**
   * Roll dice and optionally show via Dice So Nice.
   * @param {string} formula  e.g. "3d6" or "1d6"
   * @returns {Promise<Roll>}
   */
  async #roll(formula) {
    const roll = await new Roll(formula).evaluate();
    if (this.#hasDSN) {
      await game.dice3d.showForRoll(roll, game.user, true);
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
        if (game.user.isGM) this.#processPlayerAction(data.actorId, data.playerAction);
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

  /** GM creates a new game in setup phase. */
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

  /** Add an actor to the game during setup. */
  addPlayer(actorId) {
    if (!game.user.isGM || this.#state?.phase !== PHASE.SETUP) return;
    if (this.#state.players.find(p => p.actorId === actorId)) {
      ui.notifications.warn('That character is already in the game.');
      return;
    }
    const actor = game.actors.get(actorId);
    if (!actor) return;

    // Determine who controls this actor
    const ownerEntry = Object.entries(actor.ownership)
      .find(([uid, level]) => uid !== 'default' && level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
    const ownerId = ownerEntry ? ownerEntry[0] : game.user.id;

    this.#state.players.push({
      actorId,
      name: actor.name,
      img: actor.img,
      isNPC: !actor.hasPlayerOwner,
      dice: [],
      total: 0,
      status: STATUS.ACTIVE,
      ownerId
    });
    this.#broadcastState();
    this.#renderApp();
  }

  /** Remove a player during setup. */
  removePlayer(actorId) {
    if (!game.user.isGM || this.#state?.phase !== PHASE.SETUP) return;
    this.#state.players = this.#state.players.filter(p => p.actorId !== actorId);
    this.#broadcastState();
    this.#renderApp();
  }

  /** Update the ante amount during setup. */
  setAnte(amount) {
    if (!game.user.isGM || this.#state?.phase !== PHASE.SETUP) return;
    this.#state.ante = Math.max(0, Math.floor(amount));
    this.#broadcastState();
    this.#renderApp();
  }

  /** Start the game: collect antes, roll starting dice, begin play. */
  async startGame() {
    if (!game.user.isGM || this.#state?.phase !== PHASE.SETUP) return;
    if (this.#state.players.length < 2) {
      ui.notifications.warn('You need at least 2 players to start.');
      return;
    }

    // Validate all players can afford the ante
    for (const p of this.#state.players) {
      const actor = game.actors.get(p.actorId);
      if (!actor) continue;
      const gp = actor.system.currency?.gp ?? 0;
      if (gp < this.#state.ante) {
        ui.notifications.warn(`${p.name} cannot afford the ${this.#state.ante} gp ante.`);
        return;
      }
    }

    // Deduct ante from each player
    for (const p of this.#state.players) {
      const actor = game.actors.get(p.actorId);
      if (!actor) continue;
      await actor.update({
        'system.currency.gp': actor.system.currency.gp - this.#state.ante
      });
    }

    this.#state.pot = this.#state.ante * this.#state.players.length;
    this.#state.roundLog = [`Ante collected: ${this.#state.pot} gp in the pot.`];

    // Roll starting dice for each player
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

    // If everyone busted on opening roll, resolve immediately
    if (this.#state.currentPlayerIndex === -1) {
      await this.#resolveGame();
      this.#broadcast(SOCKET_ACTION.OPEN_APP, { state: this.#state });
      this.#renderApp();
      return;
    }

    // Broadcast and open on all clients
    this.#broadcast(SOCKET_ACTION.OPEN_APP, { state: this.#state });
    this.#renderApp();

    // Kick off NPC auto-play if the first player is an NPC
    this.#checkNPCAutoPlay();
  }

  /* --------------------------------------------------
   * Player actions (roll / stand)
   * -------------------------------------------------- */

  /** Called by the controlling client. */
  submitAction(actorId, action) {
    if (game.user.isGM) {
      this.#processPlayerAction(actorId, action);
    } else {
      this.#broadcast(SOCKET_ACTION.PLAYER_ACTION, { actorId, playerAction: action });
    }
  }

  async #processPlayerAction(actorId, action) {
    if (!game.user.isGM || this.#state?.phase !== PHASE.PLAYING) return;

    const player = this.#state.players[this.#state.currentPlayerIndex];
    if (!player || player.actorId !== actorId) return;

    if (action === PLAYER_ACTION.ROLL) {
      const roll = await this.#roll('1d6');
      const result = roll.terms[0].results[0].result;
      player.dice.push(result);
      player.total += result;

      if (player.total > BUST_THRESHOLD) {
        player.status = STATUS.BUST;
        this.#state.roundLog.push(`${player.name} rolled a ${result} → ${player.total} — BUST!`);
        this.#advanceTurn();
      } else {
        this.#state.roundLog.push(`${player.name} rolled a ${result} → ${player.total}`);
        // Player can keep rolling — don't advance turn
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

  /** Check if the current player is an NPC; if so, start their auto-play. */
  #checkNPCAutoPlay() {
    if (!game.user.isGM || this.#state?.phase !== PHASE.PLAYING) return;
    if (this.#npcActing) return;

    const current = this.getCurrentPlayer();
    if (!current || !current.isNPC || current.status !== STATUS.ACTIVE) return;

    this.#npcActing = true;
    this.#runNPCTurn(current).finally(() => {
      this.#npcActing = false;
    });
  }

  /**
   * Run a full NPC turn: decide, talk, act, repeat if still active.
   * @param {object} player
   */
  async #runNPCTurn(player) {
    while (player.status === STATUS.ACTIVE && this.#state?.phase === PHASE.PLAYING) {
      // Make sure it's still this NPC's turn
      const current = this.getCurrentPlayer();
      if (!current || current.actorId !== player.actorId) break;

      // Dramatic pause — 1.0–1.8 seconds
      await this.#delay(1000 + Math.random() * 800);

      // Decide
      const action = this.#npcDecide(player);

      // Smack-talk BEFORE acting
      if (action === PLAYER_ACTION.ROLL) {
        this.#postNPCChat(player, this.#pick(NPC_TALK.ROLL));
      } else {
        this.#postNPCChat(player, this.#pick(NPC_TALK.STAND));
      }

      // Small beat after the talk
      await this.#delay(600);

      // Execute the action
      await this.#processPlayerAction(player.actorId, action);

      // If they busted, post a reaction
      if (player.status === STATUS.BUST) {
        await this.#delay(500);
        this.#postNPCChat(player, this.#pick(NPC_TALK.BUST));
      }

      // If they stood or busted, the turn advanced — exit loop
      if (action === PLAYER_ACTION.STAND || player.status === STATUS.BUST) break;
    }

    // After this NPC's turn ends, check if the NEXT player is also an NPC
    if (this.#state?.phase === PHASE.PLAYING) {
      // Small pause before next player
      await this.#delay(400);
      this.#npcActing = false;
      this.#checkNPCAutoPlay();
    }
  }

  /**
   * Simple NPC decision logic with some variance.
   * @param {object} player
   * @returns {string} PLAYER_ACTION.ROLL or PLAYER_ACTION.STAND
   */
  #npcDecide(player) {
    const total = player.total;
    if (total >= 18) return PLAYER_ACTION.STAND;
    if (total >= 15) return Math.random() < 0.75 ? PLAYER_ACTION.STAND : PLAYER_ACTION.ROLL;
    if (total >= 11) return Math.random() < 0.30 ? PLAYER_ACTION.STAND : PLAYER_ACTION.ROLL;
    return PLAYER_ACTION.ROLL;
  }

  /**
   * Post an in-character chat message from an NPC.
   * @param {object} player
   * @param {string} text
   */
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
        await actor.update({
          'system.currency.gp': actor.system.currency.gp + this.#state.pot
        });
      }
      this.#state.roundLog.push(
        `${winner.name} wins ${this.#state.pot} gp with a score of ${winner.total}!`
      );
      this.#postChatResult(
        `${winner.name} wins ${this.#state.pot} gp at Baldur's Bones with a score of ${winner.total}!`
      );

      // NPC winner gloats
      if (winner.isNPC) {
        setTimeout(() => this.#postNPCChat(winner, this.#pick(NPC_TALK.WIN)), 800);
      }
    } else {
      // Tie — split pot
      const share = Math.floor(this.#state.pot / winners.length);
      const remainder = this.#state.pot - (share * winners.length);
      for (const w of winners) {
        const actor = game.actors.get(w.actorId);
        if (actor) {
          await actor.update({
            'system.currency.gp': actor.system.currency.gp + share
          });
        }
      }
      const names = winners.map(w => w.name).join(' and ');
      this.#state.winnerId = 'tie';
      this.#state.roundLog.push(
        `Tie! ${names} split the pot of ${this.#state.pot} gp (${share} gp each).`
      );
      if (remainder > 0) {
        this.#state.roundLog.push(`${remainder} gp remainder goes to the house.`);
      }
      this.#postChatResult(
        `${names} tie at ${highScore} and split the ${this.#state.pot} gp pot at Baldur's Bones!`
      );
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
    this.#state = null;
    this.#broadcast(SOCKET_ACTION.CLOSE_APP, {});
    if (this.#app?.rendered) this.#app.close();
  }

  /* --------------------------------------------------
   * Public helpers
   * -------------------------------------------------- */

  canCurrentUserAct() {
    if (!this.#state || this.#state.phase !== PHASE.PLAYING) return false;
    const current = this.#state.players[this.#state.currentPlayerIndex];
    if (!current) return false;
    // NPCs are auto-played, so no human gets action buttons for them
    if (current.isNPC) return false;
    if (game.user.isGM && !current.isNPC) return true;
    return current.ownerId === game.user.id;
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
    } else if (!this.#app.rendered) {
      this.#app.render(true);
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
