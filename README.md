# Baldur's Bones

A FoundryVTT module by [Hearthforge Creations](https://github.com/Distus).

Baldur's Bones is a push-your-luck tavern dice game from the streets of Baldur's Gate. Players and NPCs wager gold pieces, roll d6s, and try to hit the highest score without going over 21.

## Features

- **Multiplayer** — Real-time socket-synced gameplay; all players see the same game state.
- **PCs and NPCs** — Add any actor to the game. The GM adds players in the setup phase, similar to the combat tracker.
- **dnd5e Currency Integration** — Ante is deducted from each actor's gold. The winner's gold is updated automatically.
- **NPC Auto-Play** — NPCs play their turns automatically with a brief thinking delay and post in-character smack-talk to chat.
- **Dice So Nice Support** — If Dice So Nice is installed, 3D dice animate for all rolls on all clients.

## Rules

1. Each player puts the agreed ante into the pot.
2. Each player rolls **3d6** to start.
3. On your turn, choose to **Roll** (add 1d6 to your total) or **Stand** (lock in your score).
4. If your total exceeds **21**, you **bust** and are out.
5. Play continues clockwise until everyone has stood or busted.
6. The highest score wins the pot. Ties split evenly.

## How to Use

1. **GM** clicks the 🎲 dice button in the token toolbar, or types `/bb` in chat.
2. Select actors to add, set the ante, and click **Start Game**.
3. Players take turns clicking Roll or Stand. NPCs play automatically.
4. After the round, click **Play Again** for another round or **End Game** to close.

## Installation

Install via the Foundry module installer using this manifest URL:

```
https://github.com/Distus/baldurs-bones/releases/latest/download/module.json
```

## Compatibility

- **Foundry VTT:** v12–v13 (verified on v13)
- **System:** dnd5e 4.0+

## License

MIT
