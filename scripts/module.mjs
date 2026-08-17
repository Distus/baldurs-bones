import { MODULE_ID } from './constants.mjs';
import { GameManager } from './game-manager.mjs';

/* --------------------------------------------------
 * Initialization
 * -------------------------------------------------- */

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing Baldur's Bones`);

  // Guard the eq helper — only register if not already present
  if (!Handlebars.helpers['bbeq']) {
    Handlebars.registerHelper('bbeq', (a, b) => a === b);
  }
});

Hooks.once('ready', () => {
  console.log(`${MODULE_ID} | Ready`);
  const gm = GameManager.instance;
  gm.registerSocketListeners();
});

/* --------------------------------------------------
 * Scene controls – add a dice button to the token tools
 * Handles both v14 (object keyed by group name, plural "tokens")
 * and v13 (array of objects with .name, singular "token")
 * -------------------------------------------------- */

Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user.isGM) return;

  let tokenControls;
  if (Array.isArray(controls)) {
    // v13 and earlier: array of { name, tools: [...] }
    tokenControls = controls.find(c => c.name === 'token');
  } else {
    // v14+: object keyed by group name, "tokens" (plural)
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

  // v14: tools is an object; v13: tools is an array
  if (Array.isArray(tokenControls.tools)) {
    tokenControls.tools.push(tool);
  } else {
    tokenControls.tools[tool.name] = tool;
  }
});

/* --------------------------------------------------
 * Chat command: !bb (bang-command avoids v14 slash-command validation)
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
