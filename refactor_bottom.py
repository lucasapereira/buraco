import traceback
import re

try:
    with open("app/(tabs)/explore.tsx", "r", encoding="utf-8") as f:
        text = f.read()

    # Find the old Piles block
    # It might start with multiple comments due to previous bad replaces
    piles_start = "      <View style={styles.pilesRow}>"
            
    idx_piles_start = text.find(piles_start)
    if idx_piles_start == -1:
        raise ValueError("Could not find pilesRow")
    
    # We want to replace whatever comments are right above it too
    # Let's search backwards to the end of the View above
    idx_pre_piles = text.rfind("</View>\n", 0, idx_piles_start) + 8
    
    # We find the end by looking for "      {/* MÃO DO JOGADOR */}"
    hand_area_start = "      {/* MÃO DO JOGADOR */}"
    idx_piles_end = text.find(hand_area_start, idx_piles_start)
    
    piles_block = text[idx_pre_piles:idx_piles_end]
    
    # Extract Lixo and Monte actual code
    # It contains two <View style={styles.pileBox}>.
    pileboxes = piles_block.split("<View style={styles.pileBox}>")
    if len(pileboxes) < 3:
        raise ValueError("Could not split pileBox")
        
    lixo_content = "<View style={styles.pileBox}>" + pileboxes[1]
    # Remove the first closing </View> from monte_content which belongs to pilesRow
    monte_part = pileboxes[2]
    idx_last_view = monte_part.rfind("</View>") # The closing pileBox view
    idx_outer_view = monte_part.rfind("</View>", 0, idx_last_view) # The closing pilesRow view - wait, pilesRow is the outermost!
    # Let's just fix it manually since we know pileBox contains exactly one <View> for emptySlot or one <View> for filled.
    # Actually, we can just split by "        </View>\n" since pilesRow is closed at the very end.
    
    # Let's cleanly extract just what is inside pilesRow
    pilesrow_str = text[idx_piles_start:idx_piles_end]
    # Remove first and last lines to just get the children
    lines = pilesrow_str.strip().split("\n")[1:-1]
    children_content = "\n".join(lines)

    # Find Undo block
    undo_start = "      {/* BOTÃO DESFAZER JOGADA */}"
    undo_end = "      {/* MODAL MENU */}"
    idx_undo_start = text.find(undo_start)
    idx_undo_end = text.find(undo_end, idx_undo_start)
    
    undo_block = text[idx_undo_start:idx_undo_end]

    action_bar_code = f"""

      {{/* ACTION BAR INFERIOR */}}
      <View style={{styles.actionBar}}>
        <View style={{styles.actionBarLeft}}>
          {{isMyTurn && turnPhase === 'play' && turnHistory.length > 0 && (
            <TouchableOpacity
              style={{styles.undoButtonInline}}
              onPress={{() => {{
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                undoLastPlay('user');
                setSelectedCards([]);
              }}}}
              activeOpacity={{0.7}}
            >
              <Text style={{styles.undoButtonText}}>↩️ Desfazer</Text>
            </TouchableOpacity>
          )}}
        </View>

        <View style={{styles.actionBarRight}}>
{children_content}
        </View>
      </View>

"""

    # Replace in text
    # Remove undo block FIRST because it is after the hand area, so indices above aren't affected
    text = text[:idx_undo_start] + text[idx_undo_end:]
    
    # Replace piles block with action_bar_code
    text = text[:idx_pre_piles] + action_bar_code + text[idx_piles_end:]

    # Now fix styles
    styles_piles_row = r"  pilesRow: \{.*?\},"
    replacement_piles = """  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    marginBottom: 4,
    zIndex: 10,
  },
  actionBarLeft: {
    flex: 1,
    alignItems: 'flex-start',
    paddingTop: 8,
  },
  actionBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  undoButtonInline: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#FFD600',
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },"""
    text = re.sub(styles_piles_row, replacement_piles, text, flags=re.DOTALL)
    
    # We remove old undoButton style cleanly
    styles_undo = r"  // BOTÃO DESFAZER\n  undoButton: \{.*?  \},\n"
    text = re.sub(styles_undo, "", text, flags=re.DOTALL)

    with open("app/(tabs)/explore.tsx", "w", encoding="utf-8") as f:
        f.write(text)

    print("SUCCESS")
except Exception as e:
    print(f"Error: {e}")
    traceback.print_exc()
