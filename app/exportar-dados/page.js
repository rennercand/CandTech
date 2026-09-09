export const metadata = { title: "Exportar dados | CandTech", robots: { index: false, follow: false } };

export default function ExportDataPage() {
  return <main className="auth-layout"><section className="auth-card">
    <h1>Baixar os dados da sua empresa</h1>
    <p>Entre como proprietário e confirme o MFA no sistema. O download continua disponível com assinatura inativa, desde que a conta não esteja suspensa.</p>
    <p>O ZIP será salvo no seu dispositivo. Não criamos um arquivo público nem uma cópia permanente deste ZIP no site.</p>
    <p>Inclui identificação, perfil, workspace, histórico e estoque em JSON. Não inclui os arquivos anexados, todas as tabelas do sistema ou credenciais. Não é uma restauração completa e não há importação automática deste pacote.</p>
    <p>Limite de download: 4 MiB comprimidos. Para volumes maiores, contate o suporte. Guarde o arquivo em dispositivo protegido; ele contém dados da sua empresa e não possui senha própria.</p>
    <a className="primary-button" href="/api/account/export" download>Baixar ZIP dos meus dados</a>
    <p><a href="/?entrar=1">Entrar ou voltar ao sistema</a></p>
  </section></main>;
}
