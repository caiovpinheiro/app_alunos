'use strict';

// Termo de uso e regras de convivência do grupo de estudo (docs/grupo-estudo.md §2.1).
//
// RASCUNHO para revisão do jurídico antes de produção: as referências legais estão indicadas para orientar
// a revisão e a leitura do aluno, mas o texto não é parecer jurídico.
//
// Mudou o texto de forma relevante? Troque VERSAO (data AAAA-MM-DD, com ".2", ".3"… se mudar mais de uma vez
// no mesmo dia): todo aluno precisa aceitar de novo antes de voltar a usar o grupo. Correção de digitação não
// precisa de versão nova.

const VERSAO = '2026-10-31.3';
const DATA_VERSAO = VERSAO.slice(0, 10).split('-').reverse().join('/');

// O que o aluno lê antes de aceitar: frases curtas, cada uma com a base legal.
const RESUMO = [
  {
    icone: 'heart-handshake',
    titulo: 'Respeito sempre',
    texto: 'Nada de xingamento, ofensa, ameaça, perseguição ou humilhação de colegas, no grupo ou no privado.',
    lei: 'Código Penal, arts. 138 a 140 (calúnia, difamação e injúria), 146-A (intimidação sistemática, inclusive virtual), 147 (ameaça) e 147-A (perseguição)',
  },
  {
    icone: 'scale',
    titulo: 'Sem preconceito',
    texto: 'Discriminar ou ofender alguém por raça, cor, etnia, religião, origem, gênero, orientação sexual ou deficiência não é permitido e pode ser crime.',
    lei: 'Lei 7.716/1989 (crimes de racismo e injúria racial) e decisão do STF que equipara homotransfobia a racismo (ADO 26)',
  },
  {
    icone: 'graduation-cap',
    titulo: 'Integridade acadêmica',
    texto: 'Não venda, compre, peça ou divulgue prova, gabarito, respostas ou trabalho pronto, nem combine cola. Isso pode anular a sua avaliação.',
    lei: 'Regimento da instituição; em exames previstos em lei, como o ENADE, divulgar conteúdo sigiloso é crime (Código Penal, art. 311-A)',
  },
  {
    icone: 'lock',
    titulo: 'Dados pessoais protegidos',
    texto: 'Não compartilhe telefone, e-mail, CPF, endereço, senha ou @, nem seus nem de outras pessoas.',
    lei: 'Lei Geral de Proteção de Dados (Lei 13.709/2018) e Constituição Federal, art. 5º, X (intimidade e vida privada)',
  },
  {
    icone: 'image',
    titulo: 'Fotos e áudios com responsabilidade',
    texto: 'Envie só o que é seu. Nada de foto de outra pessoa sem autorização, de material com direito autoral (apostila ou videoaula inteira) ou de nudez.',
    lei: 'Código Civil, art. 20 (imagem), Lei 9.610/1998 (direitos autorais) e Código Penal, art. 218-C (divulgação de nudez sem consentimento)',
  },
  {
    icone: 'shield-check',
    titulo: 'Moderação e privacidade',
    texto: 'Toda mensagem passa por um moderador antes de aparecer. A equipe do polo lê só o que for denunciado ou retido. Fotos e áudios são apagados em 7 dias; mensagens, em até 180 dias.',
    lei: 'LGPD, arts. 6º (finalidade e necessidade), 9º (informação clara) e 15 (fim do tratamento); Marco Civil da Internet (Lei 12.965/2014), art. 7º',
  },
  {
    icone: 'building-2',
    titulo: 'Um espaço dos próprios alunos',
    texto: 'A Cruzeiro do Sul e a Eduit oferecem a ferramenta, mas não acompanham as conversas nem respondem pelo que os participantes publicam: cada um responde pelo que envia. O que se diz aqui não é orientação oficial. Você pode sair do grupo quando quiser.',
    lei: 'Marco Civil da Internet (Lei 12.965/2014), arts. 19 e 21, nos termos fixados pelo STF (Temas 533 e 987); LGPD, art. 8º, § 5º (revogação do consentimento)',
  },
];

// Termo completo (aparece em "Ler o termo completo" e nas Regras da conversa).
function secoes(midiaDias) {
  return [
    {
      titulo: '1. O que é o grupo',
      itens: [
        'O grupo de estudo é um espaço do Portal do Aluno para alunos do mesmo curso tirarem dúvidas, trocarem dicas e combinarem estudos, no grupo do curso e em conversas privadas entre colegas.',
        'A participação é opcional. Você entra ao aceitar este termo e pode sair quando quiser (seção 6).',
      ],
    },
    {
      titulo: '2. Quem oferece o grupo e quem responde pelo conteúdo',
      itens: [
        'O grupo é oferecido pela Cruzeiro do Sul e pela Eduit como uma ferramenta para os alunos conversarem entre si. As conversas são dos próprios participantes: as instituições não acompanham, não leem por rotina e não orientam o que é dito no grupo ou nas conversas privadas.',
        'Cada participante responde pelo que publica (textos, fotos e áudios). O que é dito no grupo não representa a opinião nem a orientação oficial da Cruzeiro do Sul ou da Eduit. Para informações oficiais sobre o curso, notas, provas ou financeiro, use os canais de atendimento do portal.',
        'A Cruzeiro do Sul e a Eduit não respondem pelo conteúdo publicado pelos participantes. Elas só agem para cumprir este termo e a lei: quando uma mensagem é denunciada ou retida pelo moderador, quando há ordem judicial ou para retirar conteúdo ilícito de que tomarem conhecimento (Marco Civil da Internet, arts. 19 e 21, nos termos fixados pelo STF nos Temas 533 e 987).',
        'Por isso o acesso da equipe é limitado: ela vê só as mensagens denunciadas, retidas ou bloqueadas pelo moderador, nunca a conversa inteira por rotina.',
      ],
    },
    {
      titulo: '3. Regras de convivência',
      itens: RESUMO.slice(0, 5).map((r) => `${r.titulo}: ${r.texto} (Base: ${r.lei}.)`).concat([
        'Propaganda, venda de qualquer coisa, correntes e links externos não são permitidos. Links do próprio portal e do AVA são aceitos.',
        'Você pode aparecer com um apelido em vez do nome. Ele segue as mesmas regras: nada de ofensa, dado de contato ou nome que imite professor, equipe, instituição ou outro colega. A equipe do polo vê o seu nome real quando analisa uma denúncia.',
        'Valem também o Regimento e as normas acadêmicas da instituição.',
      ]),
    },
    {
      titulo: '4. Como funciona a moderação',
      itens: [
        'Toda mensagem passa por um moderador automático antes de aparecer. Mensagens que quebram as regras não são publicadas, e você vê o motivo. Algumas ficam "em análise" até a equipe decidir.',
        'Fotos e áudios aparecem depois que a equipe do polo aprovar.',
        'Qualquer participante pode denunciar uma mensagem. Quem foi denunciado não fica sabendo quem denunciou.',
        'Conforme a gravidade, a equipe pode remover mensagens, pausar seus envios (por 24 horas ou 7 dias) ou retirar o seu acesso ao grupo. Casos graves podem seguir as normas disciplinares da instituição.',
        'Em conversas privadas, você pode bloquear um colega a qualquer momento.',
        'Dados e conteúdos só são fornecidos a autoridades mediante ordem judicial ou quando a lei exigir (Marco Civil da Internet, Lei 12.965/2014, arts. 10 e 15).',
      ],
    },
    {
      titulo: '5. Seus dados (LGPD)',
      itens: [
        'Quem trata os dados: a Cruzeiro do Sul e a Eduit, só para oferecer e moderar o grupo, como descrito aqui.',
        'Quais dados: seu nome exibido (primeiro nome e inicial do sobrenome, ou o apelido que você escolher), o curso, as mensagens, fotos e áudios que você envia, as denúncias e o registro das decisões de moderação. O seu RGM, e-mail e telefone não aparecem para os colegas.',
        'Para quê: oferecer o grupo, moderar o conteúdo e manter o ambiente seguro. Ao aceitar este termo, você consente em participar (LGPD, art. 7º, I). A moderação também se apoia no legítimo interesse de proteger os participantes e prevenir fraudes (art. 7º, IX).',
        'Quem vê: os colegas do seu curso veem as mensagens publicadas no grupo; numa conversa privada, só você e o colega. A equipe do polo vê apenas mensagens denunciadas, retidas ou bloqueadas pelo moderador. Se a moderação por inteligência artificial estiver ligada, o texto da mensagem (sem seu nome, RGM ou curso) é analisado por um fornecedor de IA contratado para isso.',
        `Por quanto tempo: fotos e áudios são apagados em ${midiaDias} dias. Mensagens e registros de moderação são apagados em até 180 dias. As fotos são gravadas sem os dados escondidos do arquivo (como localização GPS).`,
        'Seus direitos: pedir acesso, correção ou exclusão dos seus dados pelo atendimento do seu polo (LGPD, art. 18). Para revogar o consentimento, basta sair do grupo (seção 6).',
      ],
    },
    {
      titulo: '6. Entrar e sair do grupo',
      itens: [
        'Você entra no grupo ao aceitar este termo.',
        'Você pode sair a qualquer momento pelo botão "Sair do grupo". Ao sair, você deixa de ver o grupo e de aparecer na lista de colegas, e ninguém pode mais mandar mensagem privada para você. Sair revoga o seu consentimento (LGPD, art. 8º, § 5º).',
        'Na hora de sair, você escolhe se as mensagens, fotos e áudios que enviou continuam visíveis para quem ficou ou se são apagados na hora. Mensagens com denúncia em análise ficam guardadas até a equipe concluir e depois seguem os prazos da seção 5.',
        'Você pode voltar quando quiser, aceitando de novo o termo em vigor.',
      ],
    },
    {
      titulo: '7. Mudanças neste termo',
      itens: [
        `Versão de ${DATA_VERSAO}. Se o termo mudar, você verá o novo texto e precisará aceitar de novo para continuar usando o grupo.`,
      ],
    },
  ];
}

function termo(midiaDias) {
  return { versao: VERSAO, data: DATA_VERSAO, titulo: 'Regras do grupo de estudo', resumo: RESUMO, secoes: secoes(midiaDias) };
}

module.exports = { VERSAO, termo };
