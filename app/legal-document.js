import styles from "./legal-document.module.css";
import { LEGAL_EFFECTIVE_DATE, LEGAL_LINKS, LEGAL_PROVIDER } from "@/lib/legal";

export default function LegalDocument({ eyebrow, title, summary, version, children }) {
  return (
    <main className={styles.page}>
      <nav className={styles.top}><a href="/">← Voltar à CandTech</a><a href="/juridico">Central jurídica</a></nav>
      <article>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h1>{title}</h1>
        <p className={styles.meta}>Vigência: {LEGAL_EFFECTIVE_DATE}{version ? ` · Versão ${version}` : ""}</p>
        <p className={styles.summary}>{summary}</p>
        {children}
        <section className={styles.contact}>
          <h2>Responsável e contato</h2>
          <p><strong>{LEGAL_PROVIDER.name}</strong>, responsável pela CandTech, com atuação em {LEGAL_PROVIDER.location}. Solicitações: <a href={`mailto:${LEGAL_PROVIDER.email}`}>{LEGAL_PROVIDER.email}</a>.</p>
        </section>
      </article>
      <nav className={styles.links} aria-label="Documentos jurídicos">
        {LEGAL_LINKS.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
      </nav>
    </main>
  );
}
