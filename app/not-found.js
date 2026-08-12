import Link from "next/link";

export const metadata = {
  title: "Página não encontrada",
  robots: { index: false, follow: false, nocache: true },
};

export default function NotFound() {
  return (
    <main className="not-found-page">
      <section className="not-found-card" aria-labelledby="not-found-title">
        <div className="not-found-mark" aria-hidden="true">
          <span>C</span>
        </div>
        <p className="not-found-code">ERRO 404</p>
        <h1 id="not-found-title">Esta página não foi encontrada</h1>
        <p className="not-found-copy">
          O endereço pode ter mudado, estar incompleto ou pertencer a uma área privada.
        </p>
        <Link className="primary-button not-found-action" href="/">
          Voltar para a CandTech
        </Link>
      </section>
    </main>
  );
}
