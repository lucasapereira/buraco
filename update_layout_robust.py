import re

with open("app/(tabs)/explore.tsx", "r", encoding="utf-8") as f:
    lines = f.readlines()

new_lines = []
header_status_block = []
piles_block = []

i = 0
while i < len(lines):
    line = lines[i]
    
    # 1. Header & Status Bar removal (Lines 366-448)
    if 365 <= i <= 447:
        header_status_block.append(line)
        i += 1
        continue
    
    # 2. Section labels removal
    if i == 474: # Line 475: 🔴 Jogos Adversário
        i += 1
        continue
        
    if i == 557: # Line 558: 🟢 Nossos Jogos
        i += 1
        continue

    # 3. Piles Column removal (Lines 660-689)
    if 659 <= i <= 688:
        piles_block.append(line)
        i += 1
        continue
        
    # 4. Insert Header/Status Block AFTER line 555 (index 554), before line 556
    # Wait, if line 555 is `                  </View>`, we append it, then append the middle block
    if i == 554:
        new_lines.append(line)
        new_lines.append("                  {/* ========================================================== */}\n")
        new_lines.append("                  {/* INÍCIO DA ÁREA CENTRAL (PLACAR/STATUS) DIVIDINDO OS JOGOS */}\n")
        new_lines.append("                  {/* ========================================================== */}\n")
        new_lines.append("                  <View style={styles.middleDividerContainer}>\n")
        new_lines.extend(header_status_block)
        new_lines.append("                  </View>\n")
        new_lines.append("                  {/* ========================================================== */}\n")
        i += 1
        continue

    # 5. Insert Piles Row BEFORE MÃO DO JOGADOR (Line 692, index 691)
    if i == 691:
        piles_str = "".join(piles_block)
        piles_str = piles_str.replace("styles.pilesColumn", "styles.pilesRow").replace("{/* Monte e Lixo no lado direito */}", "{/* MONTE E LIXO */}")
        piles_str = piles_str.replace("        <View ", "      <View ")
        
        new_lines.append("      {/* MONTE E LIXO */}\n")
        new_lines.append(piles_str)
        new_lines.append(line)
        i += 1
        continue
        
    new_lines.append(line)
    i += 1

final_text = "".join(new_lines)

# 6. Update Piles Styles and Add middleDividerContainer
styles_replacement = """  // PILES
  pilesRow: { 
    flexDirection: 'row',
    justifyContent: 'center', 
    alignItems: 'center',
    gap: 30,
    paddingVertical: 12,
    marginTop: 8,
    backgroundColor: 'rgba(0,0,0,0.15)',
    zIndex: 50,
  },
  middleDividerContainer: {
    marginVertical: 12,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },"""

final_text = re.sub(r'  // PILES\n  pilesColumn: \{ \n.*?  \},', styles_replacement, final_text, flags=re.DOTALL)

with open("app/(tabs)/explore.tsx", "w", encoding="utf-8") as f:
    f.write(final_text)

print("SUCCESS")
