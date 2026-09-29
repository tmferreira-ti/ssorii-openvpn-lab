# Laboratório comentado: VPN site-to-site com OpenVPN

Este roteiro configura uma VPN roteada entre uma rede local e uma VPC na AWS. O objetivo é permitir que máquinas das duas redes se comuniquem usando seus endereços privados, sem publicar os serviços internos diretamente na Internet.

Todos os comandos Linux devem ser executados como `root`. Por esse motivo, os exemplos não utilizam `sudo`.

## 1. Objetivos de aprendizagem

Ao final da atividade, o aluno deverá ser capaz de:

- explicar a função de uma VPN site-to-site;
- criar uma autoridade certificadora e certificados com Easy-RSA;
- diferenciar certificado, chave privada e chave `tls-crypt`;
- configurar um servidor e um cliente OpenVPN;
- explicar a diferença entre `route` e `iroute`;
- diagnosticar a VPN com `ip`, `ss`, `ping`, `journalctl` e `tcpdump`.

## 2. Topologia utilizada

```text
REDE LOCAL                                                     AWS

172.17.0.0/24                                              10.20.0.0/16
       |                                                         |
       | enp0s8: 172.17.0.1                    ens5: 10.20.1.10  |
[servidor local]---[SSORII-VPN-LOCAL] === Internet === [GATEWAY AWS]---[servidor AWS]
  172.17.0.2       cliente OpenVPN        UDP/1194    servidor OpenVPN  10.20.2.10
                            \_____________ 10.8.0.0/24 _____________/
                                          túnel TUN
```

| Elemento | Endereço ou rede |
|---|---|
| Rede local protegida | `172.17.0.0/24` |
| Gateway local | `172.17.0.1` |
| Servidor local de logs e NTP | `172.17.0.2` |
| VPC AWS | `10.20.0.0/16` |
| Gateway VPN na AWS | `10.20.1.10` |
| Servidor privado na AWS | `10.20.2.10` |
| Rede virtual do OpenVPN | `10.8.0.0/24` |
| Transporte do OpenVPN | `UDP/1194` |
| Endereço público do gateway AWS | `IP_ELASTICO_AWS` |

O gateway AWS será o servidor OpenVPN porque possui endereço público fixo. O gateway local será o cliente e iniciará a conexão para a AWS.

O laboratório não usa NAT entre `172.17.0.0/24` e `10.20.0.0/16`. Isso preserva o IP original, algo importante para auditoria e centralização de logs.

## 3. Arquivos criptográficos

| Arquivo | Função | Distribuição |
|---|---|---|
| `ca.crt` | Certificado público da autoridade certificadora | Pode ser distribuído |
| `ca.key` | Chave privada que assina certificados | Nunca distribuir |
| `server.crt` | Identidade pública do servidor | Pode ser distribuído |
| `server.key` | Chave privada do servidor | Somente no servidor |
| `vpn-local.crt` | Identidade pública do gateway local | Pode ser distribuído |
| `vpn-local.key` | Chave privada do gateway local | Somente no gateway local |
| `tls-crypt.key` | Protege o canal de controle | Somente aos participantes da VPN |

## 4. Conferir os pré-requisitos

Execute nos dois gateways:

```bash
# Mostra endereços e interfaces de forma resumida.
ip -br address

# Mostra a tabela de roteamento atual.
ip route

# Confirma se o kernel pode encaminhar pacotes entre interfaces.
sysctl net.ipv4.ip_forward
```

O encaminhamento deve retornar `net.ipv4.ip_forward = 1`. Se retornar `0`:

```bash
# Cria uma configuração persistente para habilitar o roteamento IPv4.
printf 'net.ipv4.ip_forward=1\n' > /etc/sysctl.d/99-openvpn-forward.conf

# Recarrega as configurações do kernel sem reiniciar a máquina.
sysctl --system

# Confirma o valor aplicado.
sysctl net.ipv4.ip_forward
```

Confirme também que:

- o gateway AWS alcança `10.20.2.10`;
- o servidor local usa `172.17.0.1` como gateway;
- o Security Group permite entrada em `UDP/1194` no gateway AWS;
- as três redes do laboratório não se sobrepõem;
- o source/destination check do gateway AWS está desabilitado;
- a tabela de rotas AWS envia `172.17.0.0/24` para o gateway VPN.

Esses itens já são preparados pelo script de infraestrutura deste laboratório.

---

# Parte A — Servidor OpenVPN na AWS

## 5. Acessar o gateway AWS

No Windows, na pasta que contém a chave EC2:

```cmd
ssh -i chave.pem ubuntu@IP_ELASTICO_AWS
```

Na instância:

```bash
# Abre um shell administrativo como root.
sudo -i
```

`IP_ELASTICO_AWS` é um marcador. Cada aluno deve substituí-lo pelo Elastic IP mostrado pelo script de criação do seu próprio laboratório.

## 6. Instalar OpenVPN e Easy-RSA

```bash
# Atualiza o índice local de pacotes disponíveis.
apt update

# Instala o OpenVPN e a ferramenta de criação da PKI.
apt install -y openvpn easy-rsa

# Exibe a versão instalada e os recursos disponíveis.
openvpn --version
```

O OpenVPN implementará o túnel. O Easy-RSA criará a autoridade certificadora, as requisições, os certificados e as chaves.

## 7. Criar a infraestrutura de chaves

```bash
# Copia o modelo do Easy-RSA para um diretório de trabalho do laboratório.
make-cadir /root/easy-rsa

# Entra no diretório em que a PKI será criada.
cd /root/easy-rsa

# Inicializa a estrutura vazia da PKI no subdiretório pki.
./easyrsa init-pki

# Cria a CA e solicita uma senha para proteger sua chave privada.
./easyrsa build-ca
```

Use `SSORII-LAB-CA` como Common Name. A senha não aparece na tela durante a digitação; esse comportamento é normal.

Os arquivos centrais serão:

```text
/root/easy-rsa/pki/ca.crt
/root/easy-rsa/pki/private/ca.key
```

Nunca distribua `ca.key`.

## 8. Criar o certificado do servidor

```bash
# Cria a chave privada e a requisição do servidor.
# nopass permite que o serviço inicie automaticamente.
./easyrsa gen-req server nopass

# Assina a requisição com a finalidade de servidor TLS.
./easyrsa sign-req server server
```

Confira o Common Name `server`, digite `yes` e informe a senha da CA. Se aparecer `bad decrypt` ou `empty password`, repita o segundo comando e informe a senha correta; a requisição não precisa ser criada novamente.

```bash
# Mostra assunto, emissor e validade do certificado emitido.
openssl x509 \
  -in /root/easy-rsa/pki/issued/server.crt \
  -noout -subject -issuer -dates
```

O assunto deve ser `server` e o emissor deve ser `SSORI-LAB-CA`.

## 9. Criar o certificado do gateway local

```bash
# Cria a chave e a requisição com o Common Name vpn-local.
./easyrsa gen-req vpn-local nopass

# Assina a requisição com a finalidade de cliente TLS.
./easyrsa sign-req client vpn-local

# Exibe identidade, emissor, finalidade TLS e validade.
openssl x509 \
  -in /root/easy-rsa/pki/issued/vpn-local.crt \
  -noout -subject -issuer -ext extendedKeyUsage -dates
```

O nome `vpn-local` será usado pelo servidor para localizar a configuração individual desse cliente.

## 10. Criar a chave do canal de controle

```bash
# Cria o diretório padrão das configurações de servidor com acesso restrito.
install -d -m 700 /etc/openvpn/server

# Gera a chave que criptografa e autentica o canal de controle.
openvpn --genkey tls-crypt /etc/openvpn/server/tls-crypt.key
```

`tls-crypt` protege a negociação TLS, reduz a exposição do serviço e dificulta a identificação do tráfego como OpenVPN.

## 11. Instalar os certificados do servidor

Dentro de `/root/easy-rsa`:

```bash
# Instala o certificado público da CA.
install -m 644 pki/ca.crt /etc/openvpn/server/ca.crt

# Instala o certificado público do servidor.
install -m 644 pki/issued/server.crt /etc/openvpn/server/server.crt

# Instala a chave privada do servidor com leitura exclusiva do root.
install -m 600 pki/private/server.key /etc/openvpn/server/server.key

# Confere arquivos e permissões.
ls -l /etc/openvpn/server
```

`server.key` e `tls-crypt.key` devem ter permissão `600`.

## 12. Criar a configuração específica do cliente

```bash
# Cria o Client Configuration Directory.
install -d -m 755 /etc/openvpn/server/ccd

# Abre o arquivo cujo nome coincide com o Common Name vpn-local.
vim /etc/openvpn/server/ccd/vpn-local
```

Conteúdo comentado de `/etc/openvpn/server/ccd/vpn-local`:

```ini
# Declara que 172.17.0.0/24 está localizada atrás deste cliente.
# Esta é uma rota interna do processo OpenVPN.
iroute 172.17.0.0 255.255.255.0
```

`route` envia pacotes do kernel para o OpenVPN. `iroute` informa a qual cliente conectado o OpenVPN deverá entregá-los.

## 13. Criar o arquivo do servidor

```bash
# Abre o arquivo da instância de servidor chamada server.
vim /etc/openvpn/server/server.conf
```

Conteúdo comentado de `/etc/openvpn/server/server.conf`:

```ini
# Porta em que o servidor aguardará conexões.
port 1194

# Usa UDP somente sobre IPv4.
proto udp4

# Cria uma interface TUN de camada 3 para pacotes IP.
dev tun

# Usa uma sub-rede comum no túnel.
topology subnet

# Define a rede virtual; o servidor receberá 10.8.0.1.
server 10.8.0.0 255.255.255.0

# CA usada para validar certificados dos clientes.
ca /etc/openvpn/server/ca.crt

# Certificado público que identifica o servidor.
cert /etc/openvpn/server/server.crt

# Chave privada correspondente ao certificado do servidor.
key /etc/openvpn/server/server.key

# Usa a negociação moderna por curvas elípticas, sem DH clássico.
dh none

# Criptografa e autentica o canal de controle.
tls-crypt /etc/openvpn/server/tls-crypt.key

# Recusa versões de TLS anteriores à 1.2.
tls-version-min 1.2

# Exige certificado remoto com finalidade de cliente TLS.
remote-cert-tls client

# Define as cifras modernas permitidas no canal de dados.
# ? torna ChaCha20 opcional se a biblioteca não o suportar.
data-ciphers AES-256-GCM:AES-128-GCM:?CHACHA20-POLY1305

# Envia ao cliente a rota para toda a VPC AWS.
push "route 10.20.0.0 255.255.0.0"

# Instala no kernel do servidor a rota para a rede local.
route 172.17.0.0 255.255.255.0

# Ativa configurações individuais identificadas pelo Common Name.
client-config-dir /etc/openvpn/server/ccd

# Testa o peer a cada 10 segundos e considera a conexão perdida após 120.
keepalive 10 120

# Preserva as chaves durante reinicializações internas.
persist-key

# Preserva a interface TUN durante reinicializações internas.
persist-tun

# Reduz os privilégios do processo depois da inicialização.
user nobody

# Define o grupo sem privilégios usado pelo processo.
group nogroup

# Avisa o peer antes de encerrar uma sessão UDP.
explicit-exit-notify 1

# Registra informações suficientes para diagnóstico básico.
verb 3
```

Não habilite `BF-CBC`: os dois lados usam OpenVPN 2.6 e negociam cifras AEAD modernas.

## 14. Iniciar e verificar o servidor

```bash
# Habilita a instância no boot e inicia agora.
systemctl enable --now openvpn-server@server

# Mostra o estado detalhado sem abrir o paginador.
systemctl status openvpn-server@server --no-pager

# Mostra o processo que escuta na porta UDP 1194.
ss -lunp | grep ':1194'

# Mostra o endereço da interface virtual do servidor.
ip -br address show tun0

# Exibe as cinquenta mensagens mais recentes do serviço.
journalctl -u openvpn-server@server -n 50 --no-pager
```

Resultados esperados:

```text
0.0.0.0:1194
tun0  UNKNOWN  10.8.0.1/24
Initialization Sequence Completed
```

`ovpn-dco missing` informa somente que a aceleração DCO não está instalada. O aviso sobre `--cipher` refere-se a clientes antigos; não adicione `data-ciphers-fallback BF-CBC`.

## 15. Preparar os arquivos do cliente

```bash
# Cria um diretório privado para o pacote do gateway local.
install -d -m 700 /root/vpn-local

# Copia o certificado público da CA.
install -m 644 /root/easy-rsa/pki/ca.crt /root/vpn-local/ca.crt

# Copia o certificado público emitido para vpn-local.
install -m 644 /root/easy-rsa/pki/issued/vpn-local.crt /root/vpn-local/vpn-local.crt

# Copia a chave privada do cliente com leitura exclusiva do root.
install -m 600 /root/easy-rsa/pki/private/vpn-local.key /root/vpn-local/vpn-local.key

# Copia a chave que protege o canal de controle.
install -m 600 /etc/openvpn/server/tls-crypt.key /root/vpn-local/tls-crypt.key

# Confere arquivos e permissões.
ls -l /root/vpn-local
```

Prepare o pacote de transferência:

```bash
# Cria um arquivo tar compactado contendo vpn-local.
tar -C /root -czf /home/ubuntu/vpn-local.tar.gz vpn-local

# Entrega a propriedade ao usuário usado pelo SSH da EC2.
chown ubuntu:ubuntu /home/ubuntu/vpn-local.tar.gz

# Permite leitura e alteração somente ao usuário ubuntu.
chmod 600 /home/ubuntu/vpn-local.tar.gz

# Confere proprietário, permissões e tamanho.
ls -l /home/ubuntu/vpn-local.tar.gz
```

## 16. Transferir o pacote pelo Windows

```bash
# Sai do shell root e volta ao usuário ubuntu.
exit

# Encerra o SSH e retorna ao Windows.
exit
```

No Windows:

```cmd
REM Baixa o pacote da AWS usando a chave da EC2.
scp -i chave.pem ubuntu@IP_ELASTICO_AWS:/home/ubuntu/vpn-local.tar.gz .

REM Envia o pacote ao gateway local.
scp vpn-local.tar.gz root@192.168.56.101:/root/
```

Se a VM foi recriada e a chave SSH mudou, confira a nova impressão digital no console da VM e remova somente a entrada antiga:

```cmd
REM Remove apenas a chave antiga desse endereço.
ssh-keygen -R 192.168.56.101

REM Repete a transferência depois de conferir a nova impressão digital.
scp vpn-local.tar.gz root@192.168.56.101:/root/
```

Não apague o arquivo `known_hosts` inteiro, pois isso remove a verificação de todos os outros servidores conhecidos.

Depois de conferir a transferência, na AWS:

```bash
# Remove apenas a cópia temporária; a PKI original permanece intacta.
rm /home/ubuntu/vpn-local.tar.gz
```

---

# Parte B — Cliente OpenVPN no gateway local

## 17. Extrair e conferir o pacote

```bash
# Extrai o pacote na pasta /root.
tar -C /root -xzf /root/vpn-local.tar.gz

# Confere os quatro arquivos necessários.
ls -l /root/vpn-local
```

Devem existir `ca.crt`, `tls-crypt.key`, `vpn-local.crt` e `vpn-local.key`.

## 18. Instalar o OpenVPN

```bash
# Atualiza o índice de pacotes do Debian.
apt update

# Instala o cliente OpenVPN e suas dependências.
apt install -y openvpn

# Confirma a versão instalada.
openvpn --version
```

## 19. Instalar os arquivos do cliente

```bash
# Cria o diretório padrão de clientes com acesso restrito.
install -d -m 700 /etc/openvpn/client

# Instala o certificado da CA.
install -m 644 /root/vpn-local/ca.crt /etc/openvpn/client/ca.crt

# Instala o certificado do gateway local.
install -m 644 /root/vpn-local/vpn-local.crt /etc/openvpn/client/vpn-local.crt

# Instala a chave privada com leitura exclusiva do root.
install -m 600 /root/vpn-local/vpn-local.key /etc/openvpn/client/vpn-local.key

# Instala a chave do canal de controle.
install -m 600 /root/vpn-local/tls-crypt.key /etc/openvpn/client/tls-crypt.key

# Confere arquivos e permissões.
ls -l /etc/openvpn/client
```

## 20. Criar o arquivo do cliente

```bash
# Abre a configuração da instância chamada aws.
vim /etc/openvpn/client/aws.conf
```

Conteúdo comentado de `/etc/openvpn/client/aws.conf`:

```ini
# Habilita o modo cliente e permite receber opções do servidor.
client

# Cria uma interface TUN de camada 3.
dev tun

# Usa UDP somente sobre IPv4.
proto udp4

# Define o Elastic IP e a porta pública do servidor.
# Substitua IP_ELASTICO_AWS pelo endereço recebido no laboratório do aluno.
remote IP_ELASTICO_AWS 1194

# Usa uma porta de origem dinâmica no cliente.
nobind

# Continua tentando resolver e conectar se o servidor ficar indisponível.
resolv-retry infinite

# CA usada para validar o certificado apresentado pelo servidor.
ca /etc/openvpn/client/ca.crt

# Certificado público que identifica o gateway local.
cert /etc/openvpn/client/vpn-local.crt

# Chave privada correspondente ao certificado vpn-local.
key /etc/openvpn/client/vpn-local.key

# Protege o canal de controle com a chave compartilhada.
tls-crypt /etc/openvpn/client/tls-crypt.key

# Recusa versões de TLS anteriores à 1.2.
tls-version-min 1.2

# Exige certificado remoto com finalidade de servidor TLS.
remote-cert-tls server

# Define as cifras modernas aceitas no canal de dados.
data-ciphers AES-256-GCM:AES-128-GCM:?CHACHA20-POLY1305

# Preserva as chaves durante reinicializações internas.
persist-key

# Preserva a interface TUN durante reinicializações internas.
persist-tun

# Reduz os privilégios depois da inicialização.
user nobody

# Define o grupo sem privilégios usado pelo processo.
group nogroup

# Verifica o peer a cada 10 segundos e reconecta após 120 sem resposta.
keepalive 10 120

# Avisa o servidor antes de encerrar normalmente a sessão UDP.
explicit-exit-notify 1

# Registra informações suficientes para diagnóstico básico.
verb 3
```

Não use `redirect-gateway`: somente `10.20.0.0/16` deve passar pelo túnel. O acesso normal à Internet continua pela conexão local.

## 21. Iniciar e verificar o cliente

```bash
# Habilita a instância aws no boot e inicia agora.
systemctl enable --now openvpn-client@aws

# Mostra o estado e as mensagens recentes.
systemctl status openvpn-client@aws --no-pager

# Mostra o endereço virtual entregue ao cliente.
ip -br address show tun0

# Mostra as rotas, incluindo a recebida do servidor.
ip route show

# Exibe as cinquenta mensagens mais recentes.
journalctl -u openvpn-client@aws -n 50 --no-pager
```

Resultados observados no laboratório:

```text
Status: Initialization Sequence Completed
tun0: 10.8.0.2/24
10.20.0.0/16 via 10.8.0.1 dev tun0
Control Channel: TLSv1.3
Data Channel: cipher AES-256-GCM
```

`VERIFY OK` confirma a validação da cadeia de certificados e da finalidade TLS.

## 22. Testar a partir do gateway local

```bash
# Testa os extremos da rede virtual.
ping -c 4 10.8.0.1

# Testa o endereço privado do gateway AWS pelo túnel.
ping -c 4 10.20.1.10

# Testa o encaminhamento até o servidor privado AWS.
ping -c 4 10.20.2.10
```

Os três testes apresentaram `0% packet loss` no ambiente usado para elaborar este roteiro.

---

# Parte C — Operação e diagnóstico

## 23. Consultar os logs

No servidor AWS:

```bash
# Abre as mensagens do servidor e posiciona no final.
journalctl -u openvpn-server@server -e

# Acompanha novas mensagens; encerre com Ctrl+C.
journalctl -u openvpn-server@server -f
```

No gateway local:

```bash
# Abre as mensagens do cliente e posiciona no final.
journalctl -u openvpn-client@aws -e

# Acompanha novas mensagens; encerre com Ctrl+C.
journalctl -u openvpn-client@aws -f
```

A confirmação de inicialização é `Initialization Sequence Completed`.

## 24. Capturar pacotes

```bash
# Observa pacotes OpenVPN ainda encapsulados na conexão pública.
tcpdump -ni any udp port 1194

# Observa pacotes privados já desencapsulados.
tcpdump -ni tun0
```

## 25. Controlar os serviços

Servidor AWS:

```bash
# Reinicia depois de alterar server.conf ou o CCD.
systemctl restart openvpn-server@server

# Retorna active se o serviço estiver executando.
systemctl is-active openvpn-server@server
```

Gateway local:

```bash
# Reinicia depois de alterar aws.conf.
systemctl restart openvpn-client@aws

# Retorna active se o cliente estiver executando.
systemctl is-active openvpn-client@aws
```

## 26. Checklist de diagnóstico

Se o serviço não iniciar:

1. consulte `systemctl status` e `journalctl`;
2. confira os caminhos dos certificados e das chaves;
3. verifique se o Elastic IP em `remote` está correto;
4. confirme `UDP/1194` no Security Group;
5. confirme que os dois lados possuem a mesma `tls-crypt.key`.

Se o túnel conectar, mas as redes não se comunicarem:

1. confirme `tun0` nos dois gateways;
2. confira a rota `10.20.0.0/16` no gateway local;
3. confira a rota `172.17.0.0/24` no gateway AWS;
4. confirme que o arquivo CCD se chama `vpn-local`;
5. confira `net.ipv4.ip_forward = 1` nos dois gateways;
6. confira Security Groups e tabela de rotas da AWS;
7. confirme o source/destination check desabilitado;
8. use `tcpdump` na `tun0` para localizar onde o pacote para;
9. confirme que o host de destino permite ICMP ou a porta testada.

## 27. Fluxo final esperado

```text
Servidor AWS 10.20.2.10
        ↓
Gateway AWS 10.20.1.10
        ↓ encapsulamento e criptografia
Internet — OpenVPN UDP/1194
        ↓ túnel 10.8.0.0/24
Gateway local 172.17.0.1
        ↓ desencapsulamento e roteamento
Servidor de logs/NTP 172.17.0.2
```

Quando o rsyslog for configurado, `10.20.2.10` poderá enviar seus registros para `172.17.0.2` pela VPN, sem publicar o serviço de logs na Internet.

## 28. Questões para os alunos

1. Por que o gateway AWS foi escolhido como servidor?
2. Qual é a diferença entre `10.8.0.0/24` e as redes protegidas?
3. Por que o servidor precisa de `route` e `iroute`?
4. O que ocorreria se as duas redes usassem `172.17.0.0/24`?
5. Por que não usamos `redirect-gateway`?
6. O que seria perdido com NAT entre as redes?
7. Em qual interface aparecem pacotes desencapsulados?
8. A VPN protege um endpoint já comprometido? Por quê?

## Referências

- [Manual oficial do OpenVPN 2.6](https://openvpn.net/community-docs/community-articles/openvpn-2-6-manual.html)
- [OpenVPN Community HOWTO](https://community.openvpn.net/HOWTO)
- [OpenVPN com systemd](https://community.openvpn.net/Pages/Openvpn-systemd-use)
- [Documentação do Easy-RSA](https://easy-rsa.readthedocs.io/en/latest/)
