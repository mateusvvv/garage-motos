# Regras do Firebase

Este projeto precisa que a coleção `products` tenha leitura pública, porque a página
`pecas.html` mostra o catálogo para clientes sem login.

Use o arquivo `firestore.rules` na raiz do projeto como base para publicar as regras no
Firebase Console:

1. Acesse o Firebase Console.
2. Entre no projeto `garage-motos`.
3. Vá em Firestore Database > Rules.
4. Cole o conteúdo de `firestore.rules`.
5. Publique as regras.

Resumo das permissões:

- `products`: qualquer visitante pode ler; apenas a equipe cadastrada pode criar/editar; apenas o admin pode excluir.
- `appointments`: qualquer visitante pode solicitar agendamento; apenas a equipe pode ler/remover/bloquear.
- `serviceOrders`: apenas a equipe pode ler/criar/editar O.S; apenas o admin pode excluir/limpar histórico.
- `users`: leitura restrita ao próprio usuário ou admin; escrita só admin.

E-mails liberados para gestão:

- `leonardo1412goncalves@gmail.com`: administrador.
- `garagemotos@gmail.com`: funcionário.
