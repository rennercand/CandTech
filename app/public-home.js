export default function PublicHome() {
  return (
    <main className="public-home">
      <header className="public-home-header">
        <a className="public-home-brand" href="/" aria-label="CandTech — página inicial"><img className="brand-mark" src="/candtech-mark.svg" alt="" />CandTech</a>
        <nav aria-label="Navegação pública">
          <a href="#recursos">Recursos</a>
          <a href="/assinar">Planos</a>
          <a href="/juridico">Jurídico</a>
          <a href="/?entrar=1">Entrar</a>
        </nav>
      </header>

      <section className="public-home-hero" aria-labelledby="public-home-title">
        <div>
          <span className="public-home-eyebrow">GESTÃO SIMPLES PARA PEQUENOS NEGÓCIOS</span>
          <h1 id="public-home-title">ERP simples para organizar financeiro, estoque e vendas</h1>
          <p>Controle a rotina do seu comércio em um único lugar. A CandTech reúne contas, fluxo de caixa, produtos, compras, vendas e relatórios em uma interface direta.</p>
          <div className="public-home-actions">
            <a className="primary-button" href="/?cadastro=1">Criar minha conta</a>
            <a className="secondary-button" href="#recursos">Conhecer os recursos</a>
          </div>
          <ul className="public-home-highlights" aria-label="Principais benefícios">
            <li>Workspace salvo automaticamente</li>
            <li>Permissões por cargo</li>
            <li>Relatórios em CSV, Excel e PDF</li>
          </ul>
        </div>
        <aside className="public-home-summary" aria-label="Resumo das áreas do sistema">
          <span>VISÃO DO NEGÓCIO</span>
          <strong>Informações reunidas para decidir melhor</strong>
          <div><b>Financeiro</b><small>Contas, cobranças e fluxo de caixa</small></div>
          <div><b>Estoque</b><small>Produtos, variações e movimentações</small></div>
          <div><b>Comercial</b><small>Vendas, compras e fornecedores</small></div>
        </aside>
      </section>

      <section className="public-home-section" id="recursos" aria-labelledby="resources-title">
        <div className="public-home-section-heading">
          <span>RECURSOS DO ERP</span>
          <h2 id="resources-title">Uma rotina mais clara para o seu comércio</h2>
          <p>Cadastre dados uma vez e acompanhe cada área sem planilhas espalhadas. Os módulos compartilham o mesmo workspace e respeitam as permissões definidas pelo proprietário.</p>
        </div>
        <div className="public-home-card-grid">
          <article><h3>Movimentações organizadas</h3><p>Registre contas a pagar e receber. Dê baixa nos compromissos e acompanhe entradas, saídas e saldo por período.</p></article>
          <article><h3>Estoque com histórico</h3><p>Controle produtos, SKUs, quantidades, lotes e validades. Cada entrada, venda, compra ou desfazimento deixa um registro para conferência.</p></article>
          <article><h3>Pedidos e vendas</h3><p>Monte pedidos com vários produtos. Relacione clientes e fornecedores e mantenha a movimentação comercial próxima do estoque.</p></article>
          <article><h3>Preços e cálculos</h3><p>Calcule preço de venda, margem, financiamentos e retorno de investimentos com memória dos valores utilizados.</p></article>
          <article><h3>Relatórios práticos</h3><p>Exporte informações em CSV, Excel ou PDF. Quando autorizado, envie relatórios para a conta Google Drive conectada.</p></article>
          <article><h3>Equipe com acesso controlado</h3><p>Crie cargos, escolha as áreas permitidas e convide cada colaborador pelo próprio e-mail. O aceite exige autenticação.</p></article>
        </div>
      </section>

      <section className="public-home-business" aria-labelledby="business-title">
        <div>
          <span>PARA QUEM ESTÁ CRESCENDO</span>
          <h2 id="business-title">Feito para lojas, padarias, docerias e prestadores de serviços</h2>
        </div>
        <div>
          <p>A CandTech foi pensada para operações pequenas que precisam de controle sem transformar cada tarefa em um treinamento longo. O funcionário encontra ações claras. O proprietário acompanha os números e decide quem pode abrir cada área.</p>
          <p>Comece com os módulos necessários hoje. Depois, acrescente produtos, documentos e colaboradores no mesmo espaço. Seus dados permanecem vinculados à conta e à empresa autenticada.</p>
          <a href="/assinar">Conheça as opções para usar a CandTech</a>
        </div>
      </section>

      <footer className="public-home-footer">
        <span>© CandTech — gestão financeira e operacional.</span>
        <nav aria-label="Links institucionais"><a href="/termos">Termos</a><a href="/privacidade">Privacidade</a><a href="/cookies">Cookies</a><a href="/seguranca">Segurança</a><a href="/assinar">Planos</a></nav>
      </footer>
    </main>
  );
}
