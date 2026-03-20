# Regras do Jogo — STBL (Buraco Clássico) + Análise do Bot

## Estrutura do Jogo

- **Baralho**: 2 baralhos de 52 cartas = 104 cartas. O **2** de cada naipe é o curinga (★).
- **Jogadores**: 4 — `user` + `bot-2` = **time-1** / `bot-1` + `bot-3` = **time-2**.
- **Distribuição**: 11 cartas para cada jogador. 2 "mortos" de 11 cartas reservados.
- **Ordem de turno**: user → bot-1 → bot-2 → bot-3 (cíclico).

## Fases do Turno

1. **COMPRAR** (`draw`): compra 1 carta do monte OU pega todo o lixo (se regra permitir).
2. **JOGAR** (`play`): baixa jogos, adiciona a jogos existentes (opcional, pode jogar 0).
3. **DESCARTAR**: descarta 1 carta no lixo — encerra o turno e passa para o próximo.

## Regra do Lixo (STBL)

- Só pode pegar o lixo se conseguir **usar o topo** do lixo em algum jogo.
- "Usar" significa: topo entra num **novo jogo** (3+ cartas do mesmo naipe, valores consecutivos) OU o topo + carta(s) da mão **estendem um jogo já na mesa**.
- Após pegar: a **primeira jogada** do turno DEVE incluir o topo do lixo (nova baixa ou adição a jogo existente).

## Jogos Válidos (STBL)

- Mínimo **3 cartas**, **mesmo naipe**, valores **consecutivos**.
- Máximo **1 curinga (★)** por jogo.
- **Trincas proibidas** (mesmo valor, naipes diferentes) — só no modo Buraco Mole.
- O 2 do mesmo naipe que a sequência pode agir como a carta natural "2" (canastra limpa).
- O Ás pode ser **alto** (Q-K-A) ou **baixo** (A-2★-3).

## Canastras

| Tipo         | Condição                        | Bônus   |
|--------------|---------------------------------|---------|
| Limpa        | 7+ cartas, sem curinga          | 200 pts |
| Limpa 13     | 13 cartas, sem curinga          | 500 pts |
| Limpa 14     | 14 cartas, sem curinga          | 1000 pts|
| Suja         | 7+ cartas, com curinga          | 100 pts |

## Bater (encerrar rodada)

- Jogador fica **sem cartas na mão**.
- Time já **pegou o morto** (ou não há mortos restantes).
- Time tem pelo menos **1 canastra limpa**.
- Bônus por bater: **+100 pts**.

## Pontuação

- **Pontos das cartas** jogadas na mesa (por carta).
- **Penalidade**: cartas que ficaram na mão (subtrai).
- **Penalidade**: time não pegou o morto: **-100 pts**.
- Partida termina quando um time atinge a meta (1500 / 3000 / 5000).

### Valor das cartas
| Carta        | Pontos |
|--------------|--------|
| ★ (curinga)  | 20     |
| Ás           | 15     |
| 10,J,Q,K,7,8,9 | 10   |
| 3,4,5,6      | 5      |

---

## Análise do Bot — Bugs e Melhorias Implementadas

### Bug Crítico #1 — `doBotPlayWithPileTop`: bot tomava o lixo mas não conseguia honrar a obrigação
**Problema**: ao pegar o lixo por poder ESTENDER um jogo existente (ex: mesa=[3,4,5], mão=[6], topo=7),
o `doBotPlayWithPileTop` só tentava adicionar o topo SOZINHO ao jogo. Como [3,4,5,7] é inválido (lacuna),
ele caía no fallback e apagava a obrigação sem jogar nada — desperdiçando o turno.

**Fix**: adicionado passo 1b que tenta `addToExistingGame(topo + carta(s) da mão)` para preencher a lacuna.

### Bug #2 — `shouldTakePile`: variável `fitsExisting` duplicada (shadow) e incompleta
**Problema**: havia duas declarações `fitsExisting` no mesmo bloco (inner shadowing outer),
ambas usando apenas encaixe direto do topo — sem verificar combinações com cartas da mão.
Isso fazia o bot recusar pegar o lixo mesmo quando podia estender um jogo com a mão.

**Fix**: unificado em uma declaração que também verifica `topCard + handCard` encaixando no jogo.

### Melhoria #1 — `findBestSequences`: detecção de sequências com curinga mais longas
**Antes**: só detectava pares adjacentes com lacuna (ex: [4,★,6]).
**Depois**: detecta a sequência **mais longa possível** com 1 curinga (ex: [3,4,★,6,7,8]).

### Melhoria #2 — `cardUtility`: bônus para cartas que estendem jogos na mesa
**Antes**: utilidade baseada só na mão (cartas adjacentes, valor, trinca).
**Depois**: carta que encaixa em jogo já na mesa recebe bônus crescente (`20 + 4×tamanho do jogo`),
evitando descartar cartas que levariam a canastra.

### Melhoria #3 — `chooseBestDiscard` modo difícil: ciente de deck duplo
**Antes**: verificava se o ID exato da carta já foi descartado (em deck duplo, as duas cópias têm IDs diferentes).
**Depois**: compara por `naipe+valor`, então descartar um 7♠ já descartado continua sendo "seguro" mesmo que seja a cópia do deck 2.
