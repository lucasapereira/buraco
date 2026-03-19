import traceback

try:
    with open("app/(tabs)/explore.tsx", "r", encoding="utf-8") as f:
        text = f.read()

    # 1. extract Header
    header_start = "      {/* HEADER */}\n      <View style={styles.header}>"
    header_end_exact = "          </Text>\n        </View>\n      </View>\n"
    
    idx_h_start = text.find(header_start)
    if idx_h_start == -1:
        raise ValueError("Could not find start of header")
        
    idx_h_end = text.find(header_end_exact, idx_h_start) + len(header_end_exact)

    header_block = text[idx_h_start:idx_h_end]
    text = text[:idx_h_start] + text[idx_h_end:]

    # 2. Extract EventBanner
    event_banner_start = "      {/* BANNER DE EVENTO — no fluxo normal, não absolute */}\n      <EventBanner events={gameLog} />\n"
    idx_eb_start = text.find(event_banner_start)
    if idx_eb_start == -1:
        # maybe without trailing newline
        event_banner_start = "      {/* BANNER DE EVENTO — no fluxo normal, não absolute */}\n      <EventBanner events={gameLog} />"
        idx_eb_start = text.find(event_banner_start)
        
    if idx_eb_start != -1:
        text = text[:idx_eb_start] + text[idx_eb_start + len(event_banner_start):]
    else:
        raise ValueError("Could not find EventBanner")

    # 3. Put Header back to the top
    top_target = '      <StatusBar backgroundColor="#0D3B1E" barStyle="light-content" translucent={false} />\n'
    if top_target not in text:
        raise ValueError("Could not find top target")
    
    text = text.replace(top_target, top_target + header_block)

    # 4. Put EventBanner in middleDividerContainer
    middle_target = "                  <View style={styles.middleDividerContainer}>\n"
    if middle_target not in text:
        raise ValueError("Could not find middle target")
        
    # Indent event banner slightly for middle insertion
    event_banner_mod = event_banner_start.replace("      {/* ", "                    {/* ").replace("      <EventBanner", "                    <EventBanner")
    if not event_banner_mod.endswith("\n"):
        event_banner_mod += "\n"
        
    text = text.replace(middle_target, middle_target + event_banner_mod)

    with open("app/(tabs)/explore.tsx", "w", encoding="utf-8") as f:
        f.write(text)

    print("SUCCESS")
except Exception as e:
    print(f"Error: {e}")
    traceback.print_exc()
