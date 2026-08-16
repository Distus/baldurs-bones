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
 * -------------------------------------------------- */

Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user.isGM) return;

  const tokenControls = controls.find(c => c.name === 'token');
  if (!tokenControls) return;

  tokenControls.tools.push({
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
  });
});

/* --------------------------------------------------
 * Chat command: /bb or /baldurs-bones
 * -------------------------------------------------- */

Hooks.on('chatMessage', (chatLog, message, chatData) => {
  const cmd = message.trim().toLowerCase();
  if (cmd === '/baldurs-bones' || cmd === '/bb') {
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
