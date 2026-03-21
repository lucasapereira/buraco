# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npx expo start          # Start dev server (opens QR code for Expo Go)
npx expo start --web    # Run in browser
npx expo run:ios        # Build and run on iOS simulator
npx expo run:android    # Build and run on Android emulator
npx expo lint           # Run ESLint
```

There are no automated tests in this project.

To quickly test a specific board layout without playing through a full game, use `startLayoutTest()` from the store — it sets up a pre-defined mid-game state with multiple melds, canastas, and a stocked hand.

## Architecture

This is a React Native (Expo Router) app implementing the Brazilian card game Buraco. The game is fully client-side with no backend.

### Data flow

```
game/deck.ts        — Card type, deck generation, shuffle
game/engine.ts      — Types (GameState, Player, Team), game initialization, score calculation
game/rules.ts       — validateSequence, checkCanasta, canTakePile, sortGameCards
store/gameStore.ts  — Zustand store with all game actions; persisted via AsyncStorage
hooks/useBotAI.ts   — Bot decision loop triggered by useEffect watching currentTurnPlayerId
app/(tabs)/explore.tsx  — Main game screen (the entire in-game UI lives here)
app/(tabs)/index.tsx    — Home/config screen (difficulty, game mode, target score)
components/Card.tsx     — Card rendering with selection state
components/Hand.tsx     — Player's hand with card toggling and highlight badges
```

### Game state machine

Turn phases cycle `draw → play → discard` per player. Player order is fixed: `['user', 'bot-1', 'bot-2', 'bot-3']` where `user` + `bot-2` are `team-1` and `bot-1` + `bot-3` are `team-2`.

Key state fields:
- `mustPlayPileTopId`: when a player takes the pile (lixo), the top card ID is stored here — they **must** include it in their first meld that turn (classic mode only)
- `turnHistory`: stack of `UndoState` snapshots enabling undo within a turn (cleared on discard)
- `deads`: two face-down packs of 11 cards; a player receives one when their hand empties
- `discardedCardHistory`: tracks all discarded card IDs (used by hard-difficulty bot)

### Card representation

104 cards total (2 decks). The `2` of each suit is a wild (`isJoker: true`). Card IDs are `"${deck}-${suit}-${value}"` e.g. `"1-hearts-5"`. Face card values: J=11, Q=12, K=13, A=14.

### Validation rules

`validateSequence` in `game/rules.ts` is the single source of truth for what constitutes a valid meld:
- Minimum 3 cards
- **Classic (STBL)**: same suit, consecutive values, max 1 wild
- **Araujo Pereira**: also allows trincas (3+ cards of same value, any suit), max 1 wild per meld
- Aces can be high (Q-K-A) or low (A-2-3 with wild as 2, or A-★-3)

`checkCanasta` determines if a 7+ card meld is `clean` (no wilds), `dirty` (has wild), or `none`. A player can only go out ("bater") if their team has at least one clean canasta (classic) or any canasta (araujo_pereira).

### Bot AI (`hooks/useBotAI.ts`)

The bot runs asynchronously with `delay()` calls to simulate human pacing. Priority order per turn:
1. If `mustPlayPileTopId` set: play a meld containing that card
2. Add cards to existing team melds (`doBotAddToGamesAsync`)
3. Play new melds from hand (`doBotPlaySequencesAsync`)
4. Add to existing melds again (freed-up cards)
5. Discard

Wild card usage in `doBotAddToGamesAsync`: bots never dirty a meld unless it has 5+ cards (hard) or 6+ cards (medium). Easy never uses wilds to extend. This prevents the bot from unnecessarily dirtying clean sequences when natural cards would suffice.

### Game modes

- **classic**: Standard STBL rules — sequences only, must include pile top card in new meld, need clean canasta to go out
- **araujo_pereira**: Family variant — trincas allowed, taking pile is free (no obligation), any canasta suffices to go out

### Scoring

Canasta bonuses (on top of card point values):
- Clean canasta (7 cards): +200 | (13 cards): +500 | (14 cards): +1000
- Dirty canasta: +100
- Going out: +100
- Not having collected the dead: −100
- Cards remaining in hand: subtracted at round end
