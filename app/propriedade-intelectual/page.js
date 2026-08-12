import LegalDocument from "../legal-document";
import { COPYRIGHT_VERSION } from "@/lib/legal";
import { SITE_URL } from "@/lib/site";

export const metadata = {
  title: "Propriedade intelectual e uso da marca",
  description: "Regras para uso da marca, logotipo, imagens, telas e materiais visuais da CandTech.",
  alternates: { canonical: `${SITE_URL}/propriedade-intelectual` },
};

export default function IntellectualPropertyPage() {
  return <LegalDocument
    eyebrow="MARCA E IMAGENS"
    title="Política de Propriedade Intelectual e Uso da Marca"
    version={COPYRIGHT_VERSION}
    summary="Esta política explica quando a marca, o logotipo, as imagens e outros materiais próprios da CandTech podem ser utilizados. Ela não retira direitos previstos em lei nem reivindica propriedade sobre conteúdo de clientes, software de terceiros ou materiais licenciados por outras pessoas."
  >
    <h2>1. Titular e finalidade</h2>
    <p>A CandTech é identificada pelo nome, símbolo, logotipo, ícone e identidade visual utilizados em seus canais oficiais. Renner Fagundes Candido Bezerra administra esses ativos e os materiais próprios da CandTech, sem prejuízo dos direitos de autores, licenciantes e demais titulares que tenham participado de sua criação.</p>
    <p>Esta política concede apenas as autorizações expressamente descritas. O acesso ao site ou a contratação do serviço não transfere ao cliente qualquer direito de propriedade sobre a marca ou os materiais da CandTech.</p>

    <h2>2. Materiais abrangidos</h2>
    <p>Na medida em que sejam originais da CandTech ou utilizados com autorização, esta política abrange logotipo, símbolo, favicon, ilustrações, imagens promocionais, fotografias, vídeos, animações, textos, manuais, relatórios-modelo, disposição visual das telas e demais materiais gráficos publicados nos canais oficiais.</p>
    <p>Ideias, métodos de negócio, dados de uso comum, conteúdo inserido pelos clientes, bibliotecas de código aberto, fontes, ícones e marcas de terceiros não passam a pertencer à CandTech por aparecerem no serviço. Cada material de terceiro permanece sujeito à licença e aos direitos de seu respectivo titular.</p>

    <h2>3. Usos permitidos</h2>
    <p>É permitido visualizar os materiais durante o uso normal do serviço, compartilhar links para páginas oficiais e realizar capturas estritamente necessárias para suporte, exercício de direitos, prova, estudo, crítica, notícia ou avaliação legítima, sempre na medida permitida pela legislação aplicável.</p>
    <p>Quando houver publicação de uma captura ou pequeno trecho, identifique a CandTech como origem, preserve o contexto e não sugira parceria, patrocínio, certificação ou aprovação inexistente. Dados pessoais, financeiros, segredos comerciais e informações de outros usuários devem ser ocultados antes de qualquer divulgação.</p>

    <h2>4. Usos que exigem autorização escrita</h2>
    <p>Salvo quando a lei permitir independentemente de autorização, é necessário consentimento prévio e escrito para:</p>
    <ul>
      <li>usar o nome, logotipo, símbolo ou imagens da CandTech como marca, avatar, domínio, perfil, aplicativo, produto, embalagem, anúncio ou material comercial de terceiros;</li>
      <li>copiar, distribuir, vender, sublicenciar, adaptar, redesenhar ou criar material derivado destinado à exploração comercial;</li>
      <li>alterar cores, proporções, tipografia, elementos do símbolo ou combinar a identidade da CandTech com outra marca de forma que cause confusão;</li>
      <li>remover avisos de autoria, procedência ou propriedade intelectual;</li>
      <li>usar os materiais para fraude, falsificação, engenharia social, concorrência desleal ou para aparentar vínculo oficial inexistente;</li>
      <li>incorporar sistematicamente os materiais visuais a bancos de imagens, conjuntos de treinamento ou sistemas de geração destinados à redistribuição da identidade da CandTech, quando essa restrição for permitida pela lei aplicável.</li>
    </ul>

    <h2>5. Uso por clientes, imprensa e parceiros</h2>
    <p>Clientes podem mencionar textualmente que utilizam a CandTech. O uso do logotipo em site, anúncio, apresentação pública, depoimento ou material de venda depende de autorização escrita e deve seguir o arquivo e as orientações fornecidos pela CandTech.</p>
    <p>Imprensa, pesquisadores e avaliadores podem solicitar arquivos oficiais e confirmação de contexto pelo canal indicado ao final desta política. A autorização para uma campanha, formato ou período não se estende automaticamente a outros usos.</p>

    <h2>6. Conteúdo do cliente</h2>
    <p>Dados, logotipos, fotografias, catálogos e outros conteúdos inseridos pelo cliente permanecem sob responsabilidade e titularidade do cliente ou de seus licenciantes, conforme os Termos de Uso. O cliente deve possuir autorização para usar esse conteúdo e concede à CandTech somente a licença operacional necessária para prestar o serviço.</p>

    <h2>7. Direitos autorais e marca</h2>
    <p>A proteção autoral de obras próprias independe de registro, nos termos da legislação brasileira. Já a propriedade e o uso exclusivo de uma marca em todo o território nacional decorrem do registro validamente concedido pelo INPI. A presença dos símbolos © ou ™ informa uma reivindicação de direitos ou uso como sinal distintivo, mas não equivale ao símbolo ® nem declara registro concedido.</p>
    <p>Nada nesta política limita citações, pequenos trechos, usos privados e demais hipóteses legalmente permitidas. Também não impede referências nominativas honestas necessárias para identificar o serviço, desde que não haja confusão, aproveitamento parasitário ou prejuízo à reputação e ao caráter distintivo da marca.</p>

    <h2>8. Denúncias, autorização e medidas</h2>
    <p>Pedidos de autorização e comunicações de possível uso indevido devem indicar o material, a URL ou o canal, a finalidade, o período e a pessoa responsável. A CandTech poderá solicitar correção, atribuição, interrupção ou remoção de uso não autorizado e adotar medidas proporcionais previstas em lei, preservando defesa, boa-fé e direitos obrigatórios.</p>

    <h2>9. Atualizações</h2>
    <p>Esta política poderá ser atualizada quando a identidade visual, o titular, as licenças ou as formas autorizadas de uso mudarem. Alterações materiais serão identificadas por nova versão e, quando afetarem a licença contratual do serviço, poderão exigir novo aceite dos Termos de Uso.</p>
  </LegalDocument>;
}
