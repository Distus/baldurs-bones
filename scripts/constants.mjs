export const MODULE_ID = 'baldurs-bones';
export const SOCKET_NAME = `module.${MODULE_ID}`;
export const BUST_THRESHOLD = 21;
export const STARTING_DICE = 3;
export const MAX_ROLL_DICE = 3;

export const PHASE = {
  SETUP: 'setup',
  PLAYING: 'playing',
  RESOLUTION: 'resolution'
};

export const STATUS = {
  ACTIVE: 'active',
  STANDING: 'standing',
  BUST: 'bust'
};

export const SOCKET_ACTION = {
  CREATE_GAME: 'createGame',
  UPDATE_STATE: 'updateState',
  PLAYER_ACTION: 'playerAction',
  OPEN_APP: 'openApp',
  CLOSE_APP: 'closeApp'
};

export const PLAYER_ACTION = {
  ROLL: 'roll',
  STAND: 'stand'
};

export const NPC_TALK = {
  ROLL: [
    "Ha! The bones crave another throw!",
    "Fortune favors the bold!",
    "*cracks knuckles* Let's see what fate has in store.",
    "Another! I can feel a good one coming.",
    "You think I'd stop now?",
    "*grins* The night is young.",
    "Balduran himself couldn't stop me now!",
    "One more. Just one more.",
    "I didn't come here to play it safe.",
    "My grandmother could beat that score. Roll!",
    "*blows on the dice* Come on, lucky bones...",
    "The bones owe me one. Let's go."
  ],
  STAND: [
    "*leans back* I'll sit on this. Beat it if you can.",
    "A wise gambler knows when to hold.",
    "I like my chances right here.",
    "*smirks* Your move.",
    "Not greedy. Just smart.",
    "I'll take my chances with this.",
    "*drums fingers on the table* That'll do.",
    "Go ahead. Try to beat that.",
    "*folds arms* I know when I'm ahead.",
    "Quit while you're ahead, they say. I say quit while *I'm* ahead."
  ],
  BUST: [
    "Bah! The bones betray me!",
    "*curses under breath* Should've stood...",
    "Crooked dice, I tell you! Crooked!",
    "Well... drinks are on me, then.",
    "*slams the table* Unbelievable.",
    "The gods mock me tonight.",
    "That's... not ideal.",
    "*stares at the dice in disbelief* You've got to be kidding.",
    "I blame the table. It's uneven.",
    "I KNEW I should've stopped!"
  ],
  WIN: [
    "*sweeps the gold across the table* Pleasure doing business!",
    "Pay up! The bones know their master!",
    "Better luck next time, friends.",
    "That's how we play in the Gate!",
    "*bites a coin and grins* Beautiful.",
    "Never bet against me at Baldur's Bones.",
    "Did you really think you had a chance?",
    "*pockets the gold* Same time tomorrow?",
    "I'd say it was luck, but... *chuckles* ...it wasn't."
  ]
};
