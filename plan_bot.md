# Bot Intelligence Improvements

1. **Memory of Card Discards**: Currently, bots know what was discarded, but they don't explicitly track the "remaining cards" in the deck or what's physically impossible. By tracking cards played by everyone and the current discard pile, they could calculate probabilities for drawing a required card vs picking from the pile.

2. **Hold Cards for Big Plays**: In STBL, if we only need one card for a Canasta Limpa, hold the Wildcard (Joker/2). The bot currently holds it in some conditions, but might aggressively use it to form a dirty Canasta.

3. **Predict Opponent's Hand**: Expand `opponentHandHeat` to track what the opponent is deliberately picking up. E.g., if Opponent picks up a '5 of Spades' and plays nothing, they are likely holding '4, 6' or a pair of '5's. The bot should actively avoid discarding Spades around that range.

4. **Strategic Discards**: The bot sometimes discards randomly from non-useful cards. It should prioritize discarding what the opponent has ALREADY discarded (meaning they don't want it).

5. **Late Game Aggression**: If the opponent is close to 'bater', the bot should switch to aggressive mode: lower threshold for picking up pile, immediately meld all points, try to end the game quickly or at least dump points.
