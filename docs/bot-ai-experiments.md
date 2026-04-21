# Bot AI — Experimentos e Heurísticas

Resumo dos experimentos de IA do bot conduzidos com o harness headless `scripts/botSim.ts` contra a produção em `hooks/useBotAI.ts`.

## Status geral

| # | Heurística | Resultado |
|---|-----------|-----------|
| 1 | Smart discard (modelo de oponente) | ❌ Descartado — sinal é ruído |
| 2 | Smart pile take (1-ply lookahead) | ✅ Mergeado |
| 3 | Wild-card discipline (3-card rule) | ✅ Mergeado |
| 4 | SMART_CLOSE (6→7 dirty close) | ❌ Descartado — EV-wash |

---

## Item #1 — Smart discard com modelo de oponente

Arquivo testado: `chooseBestDiscardSmart` em `game/botHelpers.ts`.

**Resultado:** descartado. Discriminator test mostrou só 6.3% de divergência vs. baseline com peso default. Retune com `heatMult=8` chegou a 18% de divergência mas piorou o win rate (de +10pp ilusão → -2pp real). Sinal é ruído, não peso fraco.

---

## Item #2 — Smart pile take com 1-ply lookahead

Arquivo produção: `shouldTakePileSmart` importado em `hooks/useBotAI.ts`.

**Resultado:** validado e mergeado. Swap test n=300: smart vence +10 a +11pp, score médio +90 a +153/game. CI ±3pp.

---

## Item #3 — Wild-card discipline (3-card rule)

Regra: no `classic`, bloqueia meld NOVA de 3 cartas com coringa (não-natural) quando o time ainda não tem canastra limpa E não está indo pro morto. Implementada em `useBotAI.ts` dentro do guard existente de coringa.

**Resultado:** validado e mergeado. Swap test n=300: +22pp win rate médio, +262/game, canastras limpas/rodada +0.33, counterfactual OK (stranded jokers DIMINUÍRAM).

**Por quê:** instrumentação via contadores `wildLeak` no sim revelou que 68% dos coringas em melds novas entravam em sequências de 3 cartas — nessas, coringa trava o naipe como sujo permanentemente. O guard existente só bloqueava quando havia `cleanCandidate` viável (length >= 5), então o caso 3-card passava direto no início da rodada. Adicionar o caso `seq.length === 3` fecha o buraco sem tocar paths legítimos (`playWithPileTop` é função separada — obrigação de lixo passa por lá).

---

## Item #4 — SMART_CLOSE (6→7 dirty close protection)

Regra testada: bloqueia sujar canastra no fechamento (size 6→7) quando candidato limpo é viável e time não vai bater no próximo turno.

**Resultado:** descartado. Swap test mostrou assinatura de ruído:

- T2-smart (n=300): +14pp win, +148/game — parecia forte
- T1-smart (n=300): +4pp, +108/game — borderline
- T1-smart (n=500): +3.2pp (258 vs 242), Δ=+21/game — **regrediu com mais dados** (sinal real estabiliza ou cresce, não encolhe)
- Assimetria T2 +14 vs T1 +3 replica exatamente a failure mode do item #1 (ilusão de +10pp → -2pp real)

**Counterfactual falhou:** stranded wilds 1393 (smart) vs 1337 (baseline) = +4% mais encalhados. Item #3 passou porque stranded DIMINUIU; este aumenta.

**Mecanicamente funciona, mas EV-wash:** adds em 6→7 caíram 584 → 211 (-63%), mas win rate mal se mexeu. Interpretação: dirty close é roughly EV-equivalente a segurar o coringa pro próximo turno — não é leak, é tradeoff neutro.

Toggle `TEAM_SMART_CLOSE` em `scripts/botSim.ts` preservado (comentado) caso queira re-rodar; produção (`useBotAI.ts`) nunca recebeu.

---

## Metodologia (aplicável a experimentos futuros)

1. **Instrumente ANTES de criar regra** — conte onde o "leak" hipotético realmente ocorre (histograma por tamanho, turno, etc.). Intuição sem dados errou no primeiro attempt de wild-discipline (rule washed).
2. **Swap test em AMBAS as posições, n=300 mínimo.** n=100 tem CI ±5-7pp e já produziu wins ilusórios. Para bordas (+3 a +5pp), subir pra n=500.
3. **Valide o counterfactual** — se uma regra "bloqueia" algo, a ação alternativa pode ser PIOR. Medir stranded count confirma que bloqueio não está só empurrando o problema.
4. **Thresholds de decisão** (pré-committed): ≥+5pp merge, ≤+3pp file as diminishing returns, entre borderline → aumentar n.
5. **Discriminator de heurística** (substitui escolha de carta): % de divergência é o sinal mais estável (noise baixo).
6. **Assinatura de ruído** — grande assimetria entre posições (T1 +3 / T2 +14) + regressão com mais dados = noise. Item #1 e #4 compartilham essa assinatura.
