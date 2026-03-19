import sys

with open("app/(tabs)/explore.tsx", "r", encoding="utf-8") as f:
    text = f.read()

# exact strings from original file:
start_header = "      {/* HEADER */}\n      <View style={styles.header}>"
end_status_bar = "          </Text>\n        </View>\n      </View>\n"

if start_header not in text or end_status_bar not in text:
    print("Could not find header/statusBar boundaries.")
    sys.exit(1)

# we know the exact block is between these two
idx_start = text.find(start_header)
# find the SECOND occurrence of end_status_bar after idx_start because there might be multiple?
# Wait, let's just use string find for the exact end of statusBar
end_status_bar_exact = "          </Text>\n        </View>\n      </View>\n"
idx_end = text.find(end_status_bar_exact, idx_start) + len(end_status_bar_exact)

header_status_block = text[idx_start:idx_end]

# remove it from original location
text = text[:idx_start] + text[idx_end:]


middle_target = "                    })}\n                  </View>\n\n                  {/* Nossos jogos */}\n                  <Text style={[styles.sectionLabel, { marginTop: 8 }]}>🟢 Nossos Jogos</Text>\n                  {myTeamGames.length === 0 && <Text style={styles.emptyGames}>Nenhum jogo ainda</Text>}"

middle_replacement = "                    })}\n                  </View>\n\n                  {/* ========================================================== */}\n                  {/* INÍCIO DA ÁREA CENTRAL (PLACAR/STATUS) DIVIDINDO OS JOGOS */}\n                  {/* ========================================================== */}\n                  <View style={styles.middleDividerContainer}>\n" + header_status_block + "                  </View>\n                  {/* ========================================================== */}\n\n                  {/* Nossos jogos */}"

if middle_target in text:
    text = text.replace(middle_target, middle_replacement)
else:
    print("Could not find middle_target.")
    sys.exit(1)

# Remove "🔴 Jogos Adversário" and "🟢 Nossos Jogos"
text = text.replace("                  <Text style={styles.sectionLabel}>🔴 Jogos Adversário</Text>\n", "")
text = text.replace("                  {opTeamGames.length === 0 && <Text style={styles.emptyGames}>Nenhum jogo ainda</Text>}\n", "")


# 4. Move pilesColumn to pilesRow
start_piles = "        {/* Monte e Lixo no lado direito */}\n        <View style={styles.pilesColumn}>"
# This might be tricky because of exact spacing. 
idx_piles_start = text.find(start_piles)
if idx_piles_start == -1:
    print("Could not find piles column start.")
    sys.exit(1)

# we need to find the closing </View> of pilesColumn.
# It ends with:
#             )}
#           </View>
#         </View>
end_piles_exact = "            )}\n          </View>\n        </View>\n"
idx_piles_end = text.find(end_piles_exact, idx_piles_start) + len(end_piles_exact)

piles_block = text[idx_piles_start:idx_piles_end]
text = text[:idx_piles_start] + text[idx_piles_end:]

# Insert piles block before hand area
hand_area_target = "      {/* MÃO DO JOGADOR */}\n      <View style={styles.handArea}>"
if hand_area_target in text:
    piles_block_mod = piles_block.replace("styles.pilesColumn", "styles.pilesRow").replace("{/* Monte e Lixo no lado direito */}", "{/* MONTE E LIXO */}")
    
    # fix indentation slightly for PilesRow (optional but good)
    piles_block_mod = piles_block_mod.replace("        <View style={styles.pilesRow}>", "      <View style={styles.pilesRow}>")
    
    text = text.replace(hand_area_target, piles_block_mod + "\n" + hand_area_target)
else:
    print("Could not find hand area.")
    sys.exit(1)


# 5. Add new styles and remove pilesColumn
styles_target = "  // PILES\n  pilesColumn: { \n    width: 80, // Aumentado levemente para tablet\n    alignItems: 'center', \n    justifyContent: 'center', \n    gap: 20,\n    zIndex: 50, // Prioridade sobre o ScrollView de jogos\n    elevation: 5,\n    paddingRight: 4,\n  },"

styles_replacement = "  // PILES\n  pilesRow: { \n    flexDirection: 'row',\n    justifyContent: 'center', \n    alignItems: 'center',\n    gap: 30,\n    paddingVertical: 12,\n    marginTop: 8,\n    backgroundColor: 'rgba(0,0,0,0.15)',\n    zIndex: 50,\n  },\n  middleDividerContainer: {\n    marginVertical: 12,\n    borderRadius: 8,\n    overflow: 'hidden',\n    borderWidth: 1,\n    borderColor: 'rgba(255,255,255,0.1)',\n  },"

if styles_target in text:
    text = text.replace(styles_target, styles_replacement)
else:
    print("Could not find styles_target.")
    sys.exit(1)

with open("app/(tabs)/explore.tsx", "w", encoding="utf-8") as f:
    f.write(text)

print("SUCCESS")
