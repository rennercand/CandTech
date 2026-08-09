import styles from "./page.module.css";

export const metadata = {
  title: "Privacidade e cookies",
  description: "Informações sobre dados, cookies necessários e Google Analytics na CandTech.",
};

export default function PrivacyPage() {
  const privacyEmail = process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL || "";
  return (
    <main className={styles.page}>
      <nav><a href="/">← Voltar à CandTech</a></nav>
      <article>
        <span>TRANSPARÊNCIA</span>
        <h1>Privacidade e cookies</h1>
        <p className={styles.summary}>Esta página descreve a configuração técnica atual da CandTech. A política jurídica definitiva deverá incluir os dados da empresa responsável e passar por revisão profissional antes do início da comercialização.</p>

        <h2>Dados necessários para o serviço</h2>
        <p>Cadastro, autenticação, segurança, documentos e dados operacionais são tratados para disponibilizar as funções solicitadas pela pessoa usuária. Senhas são armazenadas somente como hash e cookies de sessão são protegidos contra acesso pelo JavaScript.</p>

        <h2>Google Analytics</h2>
        <p>O Google Analytics é opcional e só é carregado depois de a pessoa escolher “Aceitar análise”. Os eventos comerciais não incluem nome, e-mail, CPF/CNPJ, conteúdo de documentos ou valores financeiros.</p>

        <h2>Como mudar a escolha</h2>
        <p>Use o botão “Cookies” disponível no site. Ao recusar, a CandTech remove cookies analíticos identificáveis pelo prefixo <code>_ga</code> e deixa de carregar a ferramenta nas próximas páginas.</p>

        <h2>Compartilhamento e finalidade</h2>
        <p>Quando autorizado, o Google recebe sinais de navegação necessários para medir páginas visitadas, origem da visita e eventos comerciais agregados. Esses dados não devem ser usados pela CandTech para decidir lançamentos financeiros ou permissões.</p>

        <h2>Contato de privacidade</h2>
        {privacyEmail ? <p><a href={`mailto:${privacyEmail}`}>{privacyEmail}</a></p> : <p>O canal formal de privacidade será publicado antes do início da comercialização.</p>}
      </article>
    </main>
  );
}
