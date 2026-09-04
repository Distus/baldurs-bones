import {
  MODULE_ID, SOCKET_NAME, BUST_THRESHOLD, STARTING_DICE,
  PHASE, STATUS, SOCKET_ACTION, PLAYER_ACTION,
  NPC_TALK, NPC_CHAT_CHANCE
} from './constants.mjs';

export class GameManager {
  static #instance = null;
  #state = null;
  #app = null;
  #npcTimer = null;

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

  /* ── Utilities ─────────────────────────────── */
  #pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  get #hasDSN() { return !!(game.modules.get('dice-so-nice')?.active && game.dice3d); }

  async #roll(formula) {
    const roll = await new Roll(formula).evaluate();
    if (this.#hasDSN) {
      try {
        // Clear any lingering dice from previous rolls
        this.#clearDSN();
        await game.dice3d.showForRoll(roll, game.user, true);
      }
      catch (e) { console.warn(`${MODULE_ID} | DSN error:`, e); }
    }
    return roll;
  }

  /** Dismiss any lingering Dice So Nice 3D dice from the canvas. */
  #clearDSN() {
    try {
      if (typeof game.dice3d.dismiss === 'function') game.dice3d.dismiss();
      else if (game.dice3d.box?.clearAll) game.dice3d.box.clearAll();
      else if (game.dice3d._3dCanvas?.clearAll) game.dice3d._3dCanvas.clearAll();
    } catch (e) { /* silent — method may not exist in this DSN version */ }
  }

  /* ── Sockets ───────────────────────────────── */
  registerSocketListeners() {
    game.socket.on(SOCKET_NAME, (data) => this.#handleSocket(data));
  }
  #handleSocket(data) {
    switch (data.action) {
      case SOCKET_ACTION.UPDATE_STATE:
        this.#state = data.state; this.#renderApp(); break;
      case SOCKET_ACTION.PLAYER_ACTION:
        if (game.user.isGM) {
          if (this.#state?.phase === PHASE.INITIAL_ROLL)
            this.#processInitialRoll(data.actorId);
          else
            this.#processPlayerAction(data.actorId, data.playerAction);
        }
        break;
      case SOCKET_ACTION.CHEAT_ACTION:
        if (game.user.isGM) this.#processCheat(data.actorId, data.desiredValue);
        break;
      case SOCKET_ACTION.OPEN_APP:
        this.#state = data.state; this.openApp(); break;
      case SOCKET_ACTION.CLOSE_APP:
        this.#state = null; this.#cancelNPC();
        if (this.#app?.rendered) this.#app.close(); break;
    }
  }
  #broadcast(action, extra = {}) { game.socket.emit(SOCKET_NAME, { action, ...extra }); }

  /* ── Game Lifecycle ────────────────────────── */
  createGame() {
    this.#state = {
      id: foundry.utils.randomID(),
      phase: PHASE.SETUP,
      ante: 1, pot: 0,
      players: [],
      currentPlayerIndex: 0,
      originalOrder: null,
      hostActorId: null,
      winnerId: null,
      winnerActorIds: [],
      roundLog: []
    };
    this.openApp();
  }

  addPlayer(actorId) {
    if (!game.user.isGM || this.#state?.phase !== PHASE.SETUP) return;
    if (this.#state.players.find(p => p.actorId === actorId)) {
      ui.notifications.warn('That character is already in the game.'); return;
    }
    const actor = game.actors.get(actorId);
    if (!actor) return;
    this.#state.players.push({
      actorId, name: actor.name, img: actor.img,
      isNPC: !actor.hasPlayerOwner,
      dice: [], total: 0, status: STATUS.ACTIVE
    });
    this.#broadcastState(); this.#renderApp();
  }

  removePlayer(actorId) {
    if (!game.user.isGM || this.#state?.phase !== PHASE.SETUP) return;
    this.#state.players = this.#state.players.filter(p => p.actorId !== actorId);
    this.#broadcastState(); this.#renderApp();
  }

  setAnte(amount) {
    if (!game.user.isGM || this.#state?.phase !== PHASE.SETUP) return;
    this.#state.ante = Math.max(0, Math.floor(amount));
    this.#broadcastState(); this.#renderApp();
  }

  /** Called from "Deal the Bones". Collects antes and enters INITIAL_ROLL. */
  async startGame() {
    if (!game.user.isGM || this.#state?.phase !== PHASE.SETUP) return;
    if (this.#state.players.length < 2) {
      ui.notifications.warn('You need at least 2 players to start.'); return;
    }

    // Set original order on first round
    if (!this.#state.originalOrder) {
      this.#state.originalOrder = this.#state.players.map(p => p.actorId);
    }

    // Validate antes
    for (const p of this.#state.players) {
      const actor = game.actors.get(p.actorId);
      if (!actor) continue;
      if ((actor.system.currency?.gp ?? 0) < this.#state.ante) {
        ui.notifications.warn(`${p.name} cannot afford the ${this.#state.ante} gp ante.`); return;
      }
    }

    // Collect antes
    for (const p of this.#state.players) {
      const actor = game.actors.get(p.actorId);
      if (!actor) continue;
      await actor.update({ 'system.currency.gp': actor.system.currency.gp - this.#state.ante });
    }
    this.#state.pot = this.#state.ante * this.#state.players.length;
    this.#state.roundLog = [`Ante collected: ${this.#state.pot} gp in the pot.`];

    // Enter initial roll phase
    this.#state.phase = PHASE.INITIAL_ROLL;
    this.#state.currentPlayerIndex = 0;

    this.#broadcast(SOCKET_ACTION.OPEN_APP, { state: this.#state });
    this.#renderApp();

    // Auto-roll if first player is NPC
    this.#scheduleNPCInitialRoll();
  }

  /* ── Initial Roll Phase ────────────────────── */

  /** Player submits their initial 3d6 roll. */
  submitInitialRoll(actorId) {
    if (game.user.isGM) {
      this.#processInitialRoll(actorId);
    } else {
      this.#broadcast(SOCKET_ACTION.PLAYER_ACTION, { actorId, playerAction: PLAYER_ACTION.ROLL });
    }
  }

  async #processInitialRoll(actorId) {
    if (!game.user.isGM || this.#state?.phase !== PHASE.INITIAL_ROLL) return;
    const player = this.#state.players[this.#state.currentPlayerIndex];
    if (!player || player.actorId !== actorId) return;
    if (player.dice.length > 0) return; // already rolled

    const roll = await this.#roll(`${STARTING_DICE}d6`);
    player.dice = roll.terms[0].results.map(r => r.result);
    player.total = roll.total;

    if (player.total > BUST_THRESHOLD) {
      player.status = STATUS.BUST;
      this.#state.roundLog.push(`${player.name} rolled ${player.dice.join(', ')} = ${player.total} — BUST!`);
    } else {
      this.#state.roundLog.push(`${player.name} rolled ${player.dice.join(', ')} = ${player.total}`);
    }

    // Advance to next player
    if (this.#state.currentPlayerIndex < this.#state.players.length - 1) {
      this.#state.currentPlayerIndex++;
      this.#broadcastState(); this.#renderApp();
      this.#scheduleNPCInitialRoll();
    } else {
      // All players have rolled — determine host and enter playing
      this.#finishInitialRolls();
    }
  }

  #finishInitialRolls() {
    // Host = lowest initial roller every round. Ties broken randomly.
    const eligible = this.#state.players.filter(p => p.status !== STATUS.BUST);
    if (eligible.length > 0) {
      const lowestTotal = Math.min(...eligible.map(p => p.total));
      const lowestRollers = eligible.filter(p => p.total === lowestTotal);
      this.#state.hostActorId = this.#pick(lowestRollers).actorId;
    } else {
      this.#state.hostActorId = this.#pick(this.#state.players).actorId;
    }
    this.#reorderWithHostLast();

    const hostName = this.#state.players.find(p => p.actorId === this.#state.hostActorId)?.name ?? '?';
    this.#state.roundLog.push(`${hostName} is hosting (lowest roll).`);

    // Transition to playing
    this.#state.phase = PHASE.PLAYING;
    this.#state.currentPlayerIndex = this.#findNextActivePlayer(-1);

    if (this.#state.currentPlayerIndex === -1) {
      this.#resolveGame();
    }

    this.#broadcastState(); this.#renderApp();
    this.#scheduleNPCAction();
  }

  /** Reorder players array: non-host in original order, host last. */
  #reorderWithHostLast() {
    const hostId = this.#state.hostActorId;
    const order = this.#state.originalOrder;
    // Build ordered list: everyone in originalOrder except host, then host
    const sorted = [];
    for (const id of order) {
      if (id === hostId) continue;
      const p = this.#state.players.find(pl => pl.actorId === id);
      if (p) sorted.push(p);
    }
    const host = this.#state.players.find(p => p.actorId === hostId);
    if (host) sorted.push(host);
    this.#state.players = sorted;
  }

  /** Schedule NPC auto-roll during initial roll phase. */
  #scheduleNPCInitialRoll() {
    this.#cancelNPC();
    if (!game.user.isGM || this.#state?.phase !== PHASE.INITIAL_ROLL) return;
    const player = this.#state.players[this.#state.currentPlayerIndex];
    if (!player || !player.isNPC || player.dice.length > 0) return;

    this.#npcTimer = setTimeout(() => {
      this.#npcTimer = null;
      this.#processInitialRoll(player.actorId).catch(err => {
        console.error(`${MODULE_ID} | NPC initial roll error:`, err);
      });
    }, 800 + Math.random() * 600);
  }

  /* ── Player Actions (PLAYING phase) ────────── */

  submitAction(actorId, action) {
    if (game.user.isGM) {
      this.#processPlayerAction(actorId, action);
    } else {
      this.#broadcast(SOCKET_ACTION.PLAYER_ACTION, { actorId, playerAction: action });
    }
  }

  submitCheat(actorId, desiredValue) {
    if (game.user.isGM) {
      this.#processCheat(actorId, desiredValue);
    } else {
      this.#broadcast(SOCKET_ACTION.CHEAT_ACTION, { actorId, desiredValue });
    }
  }

  async #processPlayerAction(actorId, action) {
    if (!game.user.isGM || this.#state?.phase !== PHASE.PLAYING) return;
    const player = this.#state.players[this.#state.currentPlayerIndex];
    if (!player || player.actorId !== actorId) return;

    if (action === PLAYER_ACTION.ROLL) {
      // Always 1d6 during play
      const roll = await this.#roll('1d6');
      const result = roll.terms[0].results[0].result;
      player.dice.push(result);
      player.total += result;

      if (player.total > BUST_THRESHOLD) {
        player.status = STATUS.BUST;
        this.#state.roundLog.push(`${player.name} rolled ${result} → ${player.total} — BUST!`);
        this.#advanceTurn();
      } else {
        this.#state.roundLog.push(`${player.name} rolled ${result} → ${player.total}`);
      }
    } else if (action === PLAYER_ACTION.STAND) {
      player.status = STATUS.STANDING;
      this.#state.roundLog.push(`${player.name} stands at ${player.total}.`);
      this.#advanceTurn();
    }

    this.#broadcastState(); this.#renderApp();
    if (!player.isNPC) this.#scheduleNPCAction();
  }

  /* ── Sleight of Hand ───────────────────────── */

  async #processCheat(actorId, desiredValue) {
    if (!game.user.isGM || this.#state?.phase !== PHASE.PLAYING) return;
    const player = this.#state.players[this.#state.currentPlayerIndex];
    if (!player || player.actorId !== actorId || player.isNPC) return;

    desiredValue = Math.max(1, Math.min(6, Math.floor(desiredValue)));
    const actor = game.actors.get(actorId);
    if (!actor) return;

    const sltTotal = actor.system.skills?.slt?.total ?? 0;

    // DC = highest passive Perception among other players
    let dc = 10;
    for (const p of this.#state.players) {
      if (p.actorId === actorId) continue;
      const other = game.actors.get(p.actorId);
      if (!other) continue;
      const prc = other.system.skills?.prc?.passive ?? (10 + (other.system.skills?.prc?.total ?? 0));
      if (prc > dc) dc = prc;
    }

    const checkRoll = await new Roll('1d20').evaluate();
    const checkTotal = checkRoll.total + sltTotal;
    const success = checkTotal >= dc;
    const actualValue = success ? desiredValue : (7 - desiredValue);

    // Whisper to player and GM only
    const gmUsers = game.users.filter(u => u.isGM).map(u => u.id);
    const ownerUsers = Object.entries(actor.ownership)
      .filter(([uid, level]) => uid !== 'default' && level >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
      .map(([uid]) => uid);
    const whisperTo = [...new Set([...gmUsers, ...ownerUsers])];

    const resultText = success
      ? `Roll: ${checkRoll.total} + ${sltTotal} = <strong>${checkTotal}</strong> — <em>Success!</em><br>You deftly palm the die. It lands on <strong>${actualValue}</strong>.`
      : `Roll: ${checkRoll.total} + ${sltTotal} = <strong>${checkTotal}</strong> — <em>Failed!</em><br>Your fingers slip! The die lands on <strong>${actualValue}</strong> instead of ${desiredValue}.`;

    ChatMessage.create({
      content: `<div class="baldurs-bones-chat"><strong>🤞 Sleight of Hand (DC ${dc})</strong><br>${resultText}</div>`,
      whisper: whisperTo,
      speaker: ChatMessage.getSpeaker({ actor })
    });

    player.dice.push(actualValue);
    player.total += actualValue;

    if (player.total > BUST_THRESHOLD) {
      player.status = STATUS.BUST;
      this.#state.roundLog.push(`${player.name} rolled ${actualValue} → ${player.total} — BUST!`);
      this.#advanceTurn();
    } else {
      this.#state.roundLog.push(`${player.name} rolled ${actualValue} → ${player.total}`);
    }

    this.#broadcastState(); this.#renderApp();
    this.#scheduleNPCAction();
  }

  getCheatEligibility() {
    if (!this.#state || this.#state.phase !== PHASE.PLAYING) return null;
    const current = this.#state.players[this.#state.currentPlayerIndex];
    if (!current || current.isNPC) return null;
    const actor = game.actors.get(current.actorId);
    if (!actor) return null;
    return (actor.system.skills?.slt?.value ?? 0) >= 1 ? actor : null;
  }

  /* ── Turn Management ───────────────────────── */
  #advanceTurn() {
    const next = this.#findNextActivePlayer(this.#state.currentPlayerIndex);
    if (next === -1) this.#resolveGame();
    else this.#state.currentPlayerIndex = next;
  }

  #findNextActivePlayer(fromIndex) {
    const count = this.#state.players.length;
    for (let i = 1; i <= count; i++) {
      const idx = (fromIndex + i) % count;
      if (this.#state.players[idx].status === STATUS.ACTIVE) return idx;
    }
    return -1;
  }

  /* ── NPC Auto-Play (PLAYING phase) ─────────── */
  #cancelNPC() { if (this.#npcTimer !== null) { clearTimeout(this.#npcTimer); this.#npcTimer = null; } }

  #scheduleNPCAction() {
    this.#cancelNPC();
    if (!game.user.isGM || !this.#state || this.#state.phase !== PHASE.PLAYING) return;
    const player = this.getCurrentPlayer();
    if (!player || !player.isNPC || player.status !== STATUS.ACTIVE) return;
    this.#npcTimer = setTimeout(() => {
      this.#npcTimer = null;
      this.#executeNPCAction(player);
    }, 1200 + Math.random() * 800);
  }

  async #executeNPCAction(player) {
    try {
      if (!this.#state || this.#state.phase !== PHASE.PLAYING) return;
      if (player.status !== STATUS.ACTIVE) return;
      const current = this.getCurrentPlayer();
      if (!current || current.actorId !== player.actorId) return;

      const action = this.#npcDecide(player);

      if (action === PLAYER_ACTION.ROLL && Math.random() < NPC_CHAT_CHANCE.ROLL) {
        this.#postNPCChat(player, this.#pick(NPC_TALK.ROLL));
      } else if (action === PLAYER_ACTION.STAND && Math.random() < NPC_CHAT_CHANCE.STAND) {
        this.#postNPCChat(player, this.#pick(NPC_TALK.STAND));
      }

      this.#npcTimer = setTimeout(async () => {
        this.#npcTimer = null;
        try {
          if (!this.#state || this.#state.phase !== PHASE.PLAYING) return;
          if (player.status !== STATUS.ACTIVE) return;
          await this.#processPlayerAction(player.actorId, action);
          if (player.status === STATUS.BUST && Math.random() < NPC_CHAT_CHANCE.BUST) {
            this.#postNPCChat(player, this.#pick(NPC_TALK.BUST));
          }
          this.#scheduleNPCAction();
        } catch (err) {
          console.error(`${MODULE_ID} | NPC execute error:`, err);
          this.#forceStandNPC(player);
        }
      }, 600);
    } catch (err) {
      console.error(`${MODULE_ID} | NPC decision error:`, err);
      this.#forceStandNPC(player);
    }
  }

  #forceStandNPC(player) {
    if (!this.#state || this.#state.phase !== PHASE.PLAYING) return;
    if (player.status !== STATUS.ACTIVE) return;
    player.status = STATUS.STANDING;
    this.#state.roundLog.push(`${player.name} hesitates and stands at ${player.total}.`);
    this.#advanceTurn();
    this.#broadcastState(); this.#renderApp();
    this.#scheduleNPCAction();
  }

  #npcDecide(player) {
    const total = player.total;

    // Perfect score — always stand
    if (total === 21) return PLAYER_ACTION.STAND;

    // Always roll at 16 or below
    if (total <= 16) return PLAYER_ACTION.ROLL;

    // Get INT info
    const actor = game.actors.get(player.actorId);
    const intScore = actor?.system?.abilities?.int?.value ?? 10;
    const smart = Math.max(0, Math.min(1, (intScore - 1) / 19));

    // Check if someone already stands higher
    const bestStanding = this.#getHighestStandingTotal();
    if (bestStanding > 0 && total < bestStanding) {
      // Standing here is an auto-loss. Smart NPCs always keep rolling.
      // Dumb NPCs might not realize and stand anyway.
      // INT 1 (smart=0): 15% chance to foolishly stand
      // INT 10 (smart=0.47): ~3% chance
      // INT 14+ (smart≥0.68): effectively 0%
      const foolishStandChance = Math.max(0, 0.15 * (1 - smart * 1.4));
      if (Math.random() >= foolishStandChance) return PLAYER_ACTION.ROLL;
      // else: the fool stands and loses
      return PLAYER_ACTION.STAND;
    }

    // At 20 with no one standing higher: very high chance to stand
    if (total === 20) return Math.random() < 0.95 ? PLAYER_ACTION.STAND : PLAYER_ACTION.ROLL;

    // INT-based decision for 17–19
    // Bust probability: 17→33%, 18→50%, 19→67%
    const bustChance = Math.max(0, Math.min(1, (total - 15) / 6));

    // Smart NPCs overweight bust risk. Dumb NPCs underweight it.
    const exponent = 1.0 - (smart * 0.7);
    let standChance = Math.pow(bustChance, exponent);

    // Noise inversely proportional to INT
    const noise = (1 - smart) * 0.15;
    standChance += (Math.random() - 0.5) * 2 * noise;
    standChance = Math.max(0.05, Math.min(0.95, standChance));

    return Math.random() < standChance ? PLAYER_ACTION.STAND : PLAYER_ACTION.ROLL;
  }

  /** Returns the highest total among players who have already stood, or 0. */
  #getHighestStandingTotal() {
    if (!this.#state) return 0;
    let best = 0;
    for (const p of this.#state.players) {
      if (p.status === STATUS.STANDING && p.total > best) best = p.total;
    }
    return best;
  }

  #postNPCChat(player, text) {
    const actor = game.actors.get(player.actorId);
    const speaker = actor ? ChatMessage.getSpeaker({ actor }) : { alias: player.name };
    ChatMessage.create({ content: `<em>${text}</em>`, speaker });
  }

  /* ── Resolution ────────────────────────────── */
  async #resolveGame() {
    this.#cancelNPC();
    this.#state.phase = PHASE.RESOLUTION;

    // Safety net: fix any player at ≤21 who is incorrectly marked BUST
    for (const p of this.#state.players) {
      if (p.total <= BUST_THRESHOLD && p.status === STATUS.BUST) {
        console.warn(`${MODULE_ID} | BUG: ${p.name} marked BUST at ${p.total} — fixing to STANDING.`);
        p.status = STATUS.STANDING;
      }
    }

    const eligible = this.#state.players.filter(p => p.status !== STATUS.BUST);

    console.log(`${MODULE_ID} | Resolution:`,
      JSON.stringify(this.#state.players.map(p => ({
        name: p.name, total: p.total, status: p.status
      }))));

    if (eligible.length === 0) {
      this.#state.winnerId = null;
      this.#state.winnerActorIds = [];
      this.#state.roundLog.push('Everyone busted! The pot is lost to the house.');
      this.#postChatResult(`Everyone busted! The pot of ${this.#state.pot} gp is lost to the house.`);
      return;
    }

    eligible.sort((a, b) => b.total - a.total);
    const highScore = eligible[0].total;
    const winners = eligible.filter(p => p.total === highScore);

    // ── SET ALL STATE SYNCHRONOUSLY before any awaits ──
    // Track all winner IDs so the UI can highlight them on ties too.
    this.#state.winnerActorIds = winners.map(w => w.actorId);

    if (winners.length === 1) {
      const winner = winners[0];
      this.#state.winnerId = winner.actorId;
      this.#state.roundLog.push(`${winner.name} wins ${this.#state.pot} gp with ${winner.total}!`);

      // Async operations AFTER state is set
      const actor = game.actors.get(winner.actorId);
      if (actor) await actor.update({ 'system.currency.gp': actor.system.currency.gp + this.#state.pot });
      this.#postChatResult(`${winner.name} wins ${this.#state.pot} gp at Baldur's Bones with a score of ${winner.total}!`);
      if (winner.isNPC && Math.random() < NPC_CHAT_CHANCE.WIN) {
        setTimeout(() => this.#postNPCChat(winner, this.#pick(NPC_TALK.WIN)), 800);
      }
    } else {
      const share = Math.floor(this.#state.pot / winners.length);
      const remainder = this.#state.pot - (share * winners.length);
      const names = winners.map(w => w.name).join(' and ');
      this.#state.winnerId = 'tie';
      this.#state.roundLog.push(`Push! ${names} tied at ${highScore} and split the pot (${share} gp each).`);
      if (remainder > 0) this.#state.roundLog.push(`${remainder} gp remainder to the house.`);

      // Async operations AFTER state is set
      for (const w of winners) {
        const actor = game.actors.get(w.actorId);
        if (actor) await actor.update({ 'system.currency.gp': actor.system.currency.gp + share });
      }
      this.#postChatResult(`Push! ${names} tie at ${highScore} and split the ${this.#state.pot} gp pot!`);
    }
  }

  #postChatResult(content) {
    ChatMessage.create({
      content: `<div class="baldurs-bones-chat"><strong>🎲 Baldur's Bones</strong><br>${content}</div>`,
      speaker: { alias: "Baldur's Bones" }
    });
  }

  /* ── Play Again / End ──────────────────────── */
  playAgain() {
    if (!game.user.isGM) return;
    this.#cancelNPC();

    // Clear host — will be re-determined by lowest initial roll
    this.#state.hostActorId = null;

    // Reset all players
    for (const p of this.#state.players) {
      p.dice = []; p.total = 0; p.status = STATUS.ACTIVE;
    }
    this.#state.phase = PHASE.SETUP;
    this.#state.pot = 0;
    this.#state.currentPlayerIndex = 0;
    this.#state.winnerId = null;
    this.#state.winnerActorIds = [];
    this.#state.roundLog = [];
    this.#broadcastState(); this.#renderApp();
  }

  endGame() {
    if (!game.user.isGM) return;
    this.#cancelNPC();
    this.#state = null;
    this.#broadcast(SOCKET_ACTION.CLOSE_APP, {});
    if (this.#app?.rendered) this.#app.close();
  }

  /** GM cancels the current round. All players forfeit the pot. */
  forfeitGame() {
    if (!game.user.isGM || !this.#state) return;
    this.#cancelNPC();
    this.#state.phase = PHASE.RESOLUTION;
    this.#state.winnerId = null;
    this.#state.roundLog.push(`The game was called off. The pot of ${this.#state.pot} gp is forfeit.`);
    this.#postChatResult(`The game of Baldur's Bones was called off! The ${this.#state.pot} gp pot is forfeit.`);
    this.#broadcastState();
    this.#renderApp();
  }

  /* ── Public Helpers ────────────────────────── */
  canCurrentUserAct() {
    if (!this.#state) return false;
    const phase = this.#state.phase;
    if (phase !== PHASE.PLAYING && phase !== PHASE.INITIAL_ROLL) return false;
    const current = this.#state.players[this.#state.currentPlayerIndex];
    if (!current || current.isNPC) return false;
    const actor = game.actors.get(current.actorId);
    return actor?.isOwner ?? false;
  }

  getCurrentPlayer() {
    if (!this.#state) return null;
    const phase = this.#state.phase;
    if (phase !== PHASE.PLAYING && phase !== PHASE.INITIAL_ROLL) return null;
    return this.#state.players[this.#state.currentPlayerIndex] ?? null;
  }

  openApp() {
    if (!this.#app) {
      import('./app.mjs').then(({ BaldursBonesApp }) => {
        this.#app = new BaldursBonesApp();
        this.#app.render(true);
      });
    } else { this.#app.render(true); }
  }

  #renderApp() { if (this.#app?.rendered) this.#app.render(true); }
  #broadcastState() { this.#broadcast(SOCKET_ACTION.UPDATE_STATE, { state: this.#state }); }
}
