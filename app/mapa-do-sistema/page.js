import styles from "./page.module.css";
import { LEGAL_LINKS } from "@/lib/legal";
import { SITE_URL } from "@/lib/site";

export const metadata = {
  title: "Mapa do sistema",
  description: "Mapa das páginas públicas e dos módulos privados disponíveis no ERP CandTech.",
  alternates: { canonical: `${SITE_URL}/mapa-do-sistema` },
};

const publicAreas = [
  { title: "Página inicial", text: "Apresentação do ERP, recursos e público atendido.", href: "/" },
  { title: "Planos e assinatura", text: "Preço, implantação e gerenciamento da assinatura.", href: "/assinar" },
  { title: "Central jurídica", text: "Termos, privacidade, cookies, segurança, cobrança e marca.", href: "/juridico" },
];

const privateAreas = [
  ["Visão geral", "Vendas do mês, receitas, caixa, lucros, clientes, estoque, contas e tarefas."],
  ["Workspace", "Modelos, documentos recentes, histórico e exportações."],
  ["Clientes", "Carteira de contatos, status, WhatsApp e e-mail."],
  ["Tarefas", "Kanban com prioridade, prazo, cliente e andamento."],
  ["Pedidos e vendas", "Compras e vendas com vários produtos e reflexo no estoque."],
  ["Logística e estoque", "Produtos, variações, entrada rápida, lotes, validade e movimentações."],
  ["Movimentações", "Contas a pagar e receber, caixa, categorias, extratos e gráficos."],
  ["Financiamentos", "Simulações PRICE, SAF, SAC e SAA."],
  ["Análises", "VPL, TIR, ROI e payback para decisões de investimento."],
  ["Formação de preço", "Custos, margem, lucro unitário e preço sugerido."],
  ["Empresa e acessos", "Cargos, permissões e convites autenticados para a equipe."],
  ["Histórico", "Documentos salvos e downloads em CSV, Excel e PDF."],
];

export default function SystemMapPage() {
  return <main className={styles.page}>
    <nav className={styles.top}><a href="/">← Voltar à CandTech</a><a href="/?entrar=1">Entrar no sistema</a></nav>
    <header className={styles.hero}>
      <span>MAPA DO SISTEMA</span>
      <h1>Encontre cada área da CandTech</h1>
      <p>As páginas públicas podem ser abertas diretamente. Os módulos empresariais aparecem após autenticação e respeitam o cargo e as permissões definidos pelo proprietário.</p>
    </header>

    <section className={styles.section} aria-labelledby="public-title">
      <div className={styles.heading}><span>PÚBLICO</span><h2 id="public-title">Páginas abertas</h2></div>
      <div className={styles.grid}>{publicAreas.map((area) => <a className={styles.card} href={area.href} key={area.href}><strong>{area.title}</strong><p>{area.text}</p><i>Abrir →</i></a>)}</div>
    </section>

    <section className={styles.section} aria-labelledby="erp-title">
      <div className={styles.heading}><span>ERP AUTENTICADO</span><h2 id="erp-title">Módulos da empresa</h2><p>O menu mostra somente as áreas autorizadas para cada pessoa.</p></div>
      <div className={styles.grid}>{privateAreas.map(([title, text]) => <article className={styles.card} key={title}><strong>{title}</strong><p>{text}</p><i>Disponível após login</i></article>)}</div>
      <a className={styles.primary} href="/?entrar=1">Entrar e abrir minha empresa</a>
    </section>

    <section className={styles.section} aria-labelledby="legal-title">
      <div className={styles.heading}><span>TRANSPARÊNCIA</span><h2 id="legal-title">Documentos jurídicos</h2></div>
      <nav className={styles.legal} aria-label="Documentos jurídicos">{LEGAL_LINKS.map(([label, href]) => <a href={href} key={href}>{label}</a>)}</nav>
    </section>
  </main>;
}
