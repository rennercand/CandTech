import Link from "next/link";
import styles from "./not-found.module.css";

export const metadata = {
  title: "Página não encontrada | CandTech",
  robots: { index: false, follow: false, nocache: true },
};

export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="not-found-title">
        <div className={styles.logoWrap} aria-hidden="true">
          <img className={styles.logo} src="/candtech-mark.svg" alt="" />
        </div>
        <p className={styles.kicker}>CANDTECH · ERRO 404</p>
        <h1 className={styles.title} id="not-found-title">Página não encontrada</h1>
        <p className={styles.copy}>
          Esta parte não está disponível agora. Estamos organizando o caminho e voltaremos logo.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primary} href="/">Voltar ao início</Link>
          <Link className={styles.secondary} href="/?entrar=1">Ir para o ERP</Link>
        </div>
        <small className={styles.footer}>CandTech — organização e controle para sua empresa</small>
      </section>
    </main>
  );
}
