import { MODULE_ID } from './constants.mjs';
import { GameManager } from './game-manager.mjs';

/* --------------------------------------------------
 * Initialization
 * -------------------------------------------------- */

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing Baldur's Bones`);

  if (!Handlebars.helpers['bbeq']) {
    Handlebars.registerHelper('bbeq', (a, b) => a === b);
  }
  if (!Handlebars.helpers['array']) {
    Handlebars.registerHelper('array', (...args) => args.slice(0, -1));
  }
});

Hooks.once('ready', () => {
  console.log(`${MODULE_ID} | Ready`);
  const gm = GameManager.instance;
  gm.registerSocketListeners();
});

/* --------------------------------------------------
 * Scene controls – v14 (object, "tokens") and v13 (array, "token")
 * -------------------------------------------------- */

Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user.isGM) return;

  let tokenControls;
  if (Array.isArray(controls)) {
    tokenControls = controls.find(c => c.name === 'token');
  } else {
    tokenControls = controls.tokens;
  }
  if (!tokenControls) return;

  const tool = {
    name: 'baldurs-bones',
    title: "Baldur's Bones",
    icon: 'fas fa-dice',
    button: true,
    onClick: () => {
      const gm = GameManager.instance;
      if (gm.state) {
        gm.openApp();
      } else {
        gm.createGame();
      }
    }
  };

  if (Array.isArray(tokenControls.tools)) {
    tokenControls.tools.push(tool);
  } else {
    tokenControls.tools[tool.name] = tool;
  }
});

/* --------------------------------------------------
 * Chat command: !bb
 * -------------------------------------------------- */

Hooks.on('chatMessage', (chatLog, message, chatData) => {
  const cmd = message.trim().toLowerCase();
  if (cmd === '!bb' || cmd === '!baldurs-bones') {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can start a game of Baldur's Bones.");
      return false;
    }
    const gm = GameManager.instance;
    if (gm.state) {
      gm.openApp();
    } else {
      gm.createGame();
    }
    return false;
  }
});
