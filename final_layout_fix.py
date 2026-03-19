import traceback

try:
    with open("app/(tabs)/explore.tsx", "r", encoding="utf-8") as f:
        text = f.read()

    # 1. Extract StatusBar
    status_bar_start = "      {/* STATUS BAR DOS JOGADORES */}\n      <View style={styles.statusBar}>"
    status_bar_end_exact = "          </Text>\n        </View>\n      </View>\n"
    idx_sb_start = text.find(status_bar_start)
    if idx_sb_start == -1:
        raise ValueError("StatusBar not found")
    idx_sb_end = text.find(status_bar_end_exact, idx_sb_start) + len(status_bar_end_exact)

    status_bar_block = text[idx_sb_start:idx_sb_end]

    # remove status bar from top
    text = text[:idx_sb_start] + text[idx_sb_end:]

    # Indent the status bar roughly to fit the middle container visually
    status_bar_indented = ""
    for line in status_bar_block.split("\n"):
        if line.strip():
            status_bar_indented += "              " + line + "\n"
        else:
            status_bar_indented += "\n"

    # Remove the extra newline at the end if present to avoid doubling
    if status_bar_indented.endswith("\n\n"):
        status_bar_indented = status_bar_indented[:-1]

    # 2. Find old middle and replace
    old_middle = (
        "                  <View style={styles.middleDividerContainer}>\n"
        "                    {/* BANNER DE EVENTO — no fluxo normal, não absolute */}\n"
        "                    <EventBanner events={gameLog} />\n\n"
        "                  </View>\n"
    )

    new_middle = (
        "                  <View style={styles.middleDividerContainer}>\n"
        f"{status_bar_indented}"
        "                    {/* BANNER DE EVENTO — no fluxo normal, não absolute */}\n"
        "                    <EventBanner events={gameLog} />\n"
        "                  </View>\n"
    )

    if old_middle in text:
        text = text.replace(old_middle, new_middle)
    else:
        # Fallback if whitespace differs
        idx_mid = text.find("                  <View style={styles.middleDividerContainer}>")
        idx_mid_end = text.find("                  </View>", idx_mid) + len("                  </View>\n")
        
        if idx_mid != -1:
            actual_middle = text[idx_mid:idx_mid_end]
            text = text.replace(actual_middle, new_middle)
        else:
            raise ValueError("middleDividerContainer not found")

    with open("app/(tabs)/explore.tsx", "w", encoding="utf-8") as f:
        f.write(text)

    print("SUCCESS")
except Exception as e:
    print(f"Error: {e}")
    traceback.print_exc()
