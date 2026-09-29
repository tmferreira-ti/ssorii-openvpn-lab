# Publicar o guia no GitHub Pages

O site está preparado para ser publicado diretamente a partir da raiz do repositório. Ele usa:

- `index.html` como página inicial;
- `assets/styles.css` para o layout;
- `assets/app.js` para renderização, busca, tema e cópia de comandos;
- `aws-vpn-lab/HOWTO-OPENVPN-SITE-TO-SITE.md` como fonte do conteúdo;
- `.nojekyll` para informar ao GitHub Pages que o conteúdo é um site estático.

## 1. Enviar os arquivos ao GitHub

No repositório local:

```bash
# Mostra os arquivos que serão adicionados ao commit.
git status

# Adiciona apenas os arquivos do site e do guia.
git add index.html assets .nojekyll PUBLICAR-GITHUB-PAGES.md aws-vpn-lab/HOWTO-OPENVPN-SITE-TO-SITE.md

# Registra os arquivos no histórico local.
git commit -m "Publica guia web do laboratório OpenVPN"

# Envia a branch atual ao repositório remoto.
git push
```

Antes do `git add`, confirme que nenhum arquivo `.pem`, `.key`, certificado privado ou pacote contendo credenciais foi colocado no repositório.

## 2. Ativar o GitHub Pages

No GitHub:

1. abra o repositório;
2. entre em **Settings**;
3. selecione **Pages**;
4. em **Build and deployment**, escolha **Deploy from a branch**;
5. selecione a branch publicada, normalmente `main` ou `master`;
6. escolha a pasta **/(root)**;
7. clique em **Save**.

Depois da publicação, o endereço normalmente seguirá este formato:

```text
https://USUARIO.github.io/NOME-DO-REPOSITORIO/
```

## 3. Atualizar o conteúdo

O site lê diretamente o arquivo Markdown. Para atualizar a página, altere:

```text
aws-vpn-lab/HOWTO-OPENVPN-SITE-TO-SITE.md
```

Depois faça um novo commit e envie a alteração. Não é necessário converter manualmente o Markdown para HTML.

## 4. Testar localmente

O navegador não permite que uma página aberta por `file://` leia outro arquivo local com `fetch`. Use um servidor HTTP dentro da raiz do repositório:

```bash
# Inicia um servidor local na porta 8000.
python -m http.server 8000
```

Abra:

```text
http://127.0.0.1:8000/
```

Encerre o servidor com `Ctrl+C`.
