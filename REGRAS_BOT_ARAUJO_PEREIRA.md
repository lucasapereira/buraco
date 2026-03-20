# Regras do Jogo — Buraco Mole (araujo_pereira) + Análise do Bot

## Diferenças em relação ao STBL Clássico

| Regra                        | STBL Clássico          | Buraco Mole              |
|------------------------------|------------------------|--------------------------|
| Trincas (mesmo valor)        | ❌ Proibidas           | ✅ Liberadas             |
| Pegar o lixo                 | Precisa usar o topo    | ✅ Livre (qualquer hora) |
| Canastra para bater          | Limpa obrigatória      | ✅ Qualquer canasta      |
| Obrigação após pegar lixo    | Jogar o topo           | ❌ Sem obrigação         |

## Jogos Válidos (Buraco Mole)

### Sequências (igual ao STBL)
- 3+ cartas do **mesmo naipe**, valores **consecutivos**.
- Máximo **1 curinga** por jogo.

### Trincas (exclusivo Buraco Mole)
- 3+ cartas do **mesmo valor**, naipes diferentes (ou iguais).
- Máximo **1 curinga** por jogo.
- Trinca limpa: 7+ cartas sem curinga → **200 pts** (ou 500/1000 para 13/14 cartas).
- Trinca suja: 7+ cartas com curinga → **100 pts**.

## Pegar o Lixo (Buraco Mole)

- Pode pegar **sempre**, sem precisar usar o topo.
- O topo do lixo é marcado como `mustPlayPileTopId` internamente, mas **não é obrigatório jogar** — o bot usa como dica estratégica.
- Vale muito a pena pegar um lixo grande pois aumenta as opções da mão.

## Bater (encerrar rodada)

- Ficar sem cartas na mão.
- Já ter pegado o morto (ou não ter mortos restantes).
- Time ter **qualquer canastra** (suja ou limpa) — diferente do clássico.

---

## Análise do Bot — Bugs e Melhorias Implementadas

### Bug #1 — `shouldTakePile` hard mode: sempre pegava o lixo mesmo quando inútil
**Problema**: Em araujo_pereira hard, após todas as verificações de utilidade, o bot caia no
`if (difficulty === 'hard') return true` incondicional — pegando até um lixo de 1 carta
inútil (ex: K♦ sem diamantes na mão e sem jogos de ouros na mesa).

**Fix**: Hard pega o lixo se `usefulCount >= 1` OU se o lixo tem 2+ cartas
(pois num lixo maior as chances de ter algo útil são altas).

### Bug/Melhoria #2 — `findBestSequences`: trinca suja desperdiçava curinga desnecessariamente
**Problema**: O bot gerava uma "Trinca Suja" (com curinga) MESMO quando já podia criar uma
"Trinca Limpa" com as cartas disponíveis — desperdiçando o curinga que poderia preencher
lacunas em sequências.

**Fix**: Trinca suja só é gerada quando NÃO é possível fazer a trinca limpa (< 3 cartas do mesmo valor).

### Melhoria #1 — `doBotAddToGamesAsync`: threshold do curinga para trincas em araujo_pereira
**Antes**: Hard só adicionava curinga a jogos com 4+ cartas (mesma regra do clássico).
**Depois**: Em araujo_pereira, para jogos do tipo **trinca**, o limite foi reduzido para 3 cartas
(qualquer trinca válida aceita o curinga para acelerar a canastra).

### Melhoria #2 — `cardUtility`: bônus maior para extensão de trincas na mesa
**Antes**: Bônus para extensão de jogo era igual para sequências e trincas.
**Depois**: Extensão de uma trinca na mesa recebe bônus maior (`30 + 5×tamanho`)
vs sequência (`20 + 4×tamanho`), porque trinca é mais fácil de completar
(qualquer naipe serve) e deve ser priorizada.

### Melhoria #3 — `chooseBestDiscard` hard araujo_pereira: descarte defensivo por VALOR
**Antes**: Verificava se mesmo naipe+valor já foi descartado (baseado em IDs de deck duplo).
**Depois**: Em araujo_pereira, também verifica se o mesmo VALOR (qualquer naipe) já
foi descartado — porque trincas não dependem de naipe, e descartar um 5 quando
já existe um 5♣ no lixo é mais seguro (menos chance de ajudar o adversário a completar trinca).
