# Configuração do Firebase

## 1. Criar o projeto

1. Acesse https://console.firebase.google.com
2. Clique em **"Adicionar projeto"**
3. Dê um nome (ex: `buraco-family`)
4. Desative o Google Analytics (não precisa)
5. Clique em **"Criar projeto"**

---

## 2. Registrar o app

1. Na página inicial do projeto, clique no ícone **Android** (ou **</>** para Web)
2. Para Android: use o package name do app.json (ex: `com.seunome.buraco`)
3. Clique em **"Registrar app"** e **"Próximo"** até concluir (não precisa baixar o google-services.json)

---

## 3. Ativar Authentication (Login Anônimo)

1. No menu esquerdo: **Authentication** → **Sign-in method**
2. Clique em **"Anônimo"**
3. Ative e clique em **"Salvar"**

---

## 4. Criar o Realtime Database

1. No menu esquerdo: **Realtime Database** → **Criar banco de dados**
2. Escolha a região mais próxima (ex: `us-central1`)
3. Selecione **"Iniciar no modo de teste"** (permite leitura/escrita por 30 dias — suficiente para testes)
4. Copie a **URL do banco** (ex: `EXPO_PUBLIC_FIREBASE_DATABASE_URL`)

### Regras do banco (após os testes, configure assim):

No painel do Realtime Database → **Regras**, cole:

```json
{
  "rules": {
    "rooms": {
      "$roomCode": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

---

## 5. Pegar as credenciais do app

1. No menu esquerdo: **Configurações do projeto** (ícone de engrenagem)
2. Role até **"Seus aplicativos"** → **SDK do Firebase**
3. Selecione **"Config"** e copie o objeto `firebaseConfig`

---

## 6. Preencher o arquivo `config/firebase.ts`

Abra o arquivo `config/firebase.ts` e substitua os `FILL_ME` pelos valores copiados:

```typescript
const firebaseConfig = {
  apiKey:            'AIzaSy...',
  authDomain:        'buraco-family.firebaseapp.com',
  databaseURL:       'EXPO_PUBLIC_FIREBASE_DATABASE_URL',
  projectId:         'buraco-family',
  storageBucket:     'buraco-family.appspot.com',
  messagingSenderId: '123456789',
  appId:             '1:123456789:web:abc123',
};
```

---

## 7. Testar

1. Rode o app: `npx expo start`
2. Abra em dois dispositivos (ou emulador + celular)
3. Clique em **"Jogar Online"** → **"Criar Sala"** no primeiro
4. No segundo, insira o código e clique **"Entrar"**
5. O host clica **"Iniciar Jogo"**

---

## Estrutura do banco de dados

```
rooms/
  {CÓDIGO}/
    meta/
      status: "lobby" | "playing" | "finished"
      hostUid: "..."
      mode: "classic" | "araujo_pereira"
      targetScore: 1500
      difficulty: "hard"
      createdAt: 1234567890
    seats/
      0: { uid: "...", name: "Você" }
      1: { uid: "...", name: "Pai" }
      2: null
      3: null
    gameState/
      ... (estado completo do jogo)
      _writerUid: "..." (quem escreveu por último)
```
