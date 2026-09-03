export const MODULE_ID = 'baldurs-bones';
export const SOCKET_NAME = `module.${MODULE_ID}`;
export const BUST_THRESHOLD = 21;
export const STARTING_DICE = 3;

export const PHASE = {
  SETUP: 'setup',
  INITIAL_ROLL: 'initialRoll',
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
  CHEAT_ACTION: 'cheatAction',
  OPEN_APP: 'openApp',
  CLOSE_APP: 'closeApp'
};

export const PLAYER_ACTION = {
  ROLL: 'roll',
  STAND: 'stand'
};

export const NPC_CHAT_CHANCE = {
  ROLL: 0.25,
  STAND: 0.25,
  BUST: 0.25,
  WIN: 0.25
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
    "The bones owe me one. Let's go.",
    "The bones won't roll themselves!",
    "*rattles the dice* Here goes nothing.",
    "I've got a feeling about this one.",
    "*stares at the dice* Don't you dare betray me.",
    "What's life without a little risk?",
    "I've seen worse odds in the Underdark.",
    "Just one more throw. For luck.",
    "*winks* Watch and learn.",
    "The table's not going anywhere. Neither am I.",
    "Tymora, guide my hand!",
    "You'd stand on THAT? Cowards.",
    "Let's see if the bones still like me."
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
    "Quit while you're ahead, they say. I say quit while *I'm* ahead.",
    "I've pushed my luck far enough.",
    "*slides the dice away* Done.",
    "Read it and weep.",
    "Sometimes the best move is no move at all.",
    "I'll keep what the bones gave me.",
    "*crosses arms* Steady hands, steady score.",
    "That's a winning number. I can feel it.",
    "You lot can fight over the scraps.",
    "The bones have spoken. I listen.",
    "Smart money stays right here."
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
    "I KNEW I should've stopped!",
    "Tymora has forsaken me!",
    "*pushes back from the table* Well then.",
    "I'll get you next round. Mark my words.",
    "That's rigged. Has to be.",
    "*head in hands* Every. Time.",
    "The bones are cursed, I tell you.",
    "And THAT is why I usually cheat.",
    "My cat could play better than this.",
    "Fine. FINE. Who wants a drink?",
    "*mutters something about probability*"
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
    "I'd say it was luck, but... *chuckles* ...it wasn't.",
    "*polishes nails* Too easy.",
    "The bones always favor the worthy.",
    "I'll take that in gold, if you please.",
    "*leans in* Want to go again? I could use more gold.",
    "That's the sound of coins hitting my purse.",
    "Don't feel bad. You never had a chance.",
    "Another round? I'm feeling generous... sort of.",
    "*counts the coins slowly* Beautiful, every one.",
    "Baldur's Bones. Baldur's game. My gold."
  ]
};
