<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Diretrizes do projeto

- O destino final do sistema é a VPS do usuário, confirmado em 27/11/2026. Preservar compatibilidade com hospedagem própria e não exigir serviços exclusivos da Vercel.
- Uso exclusivo da gatu.digital, com uma pessoa recebendo reuniões. Escrever a marca sempre em minúsculas.
- Reuniões de 60 minutos por padrão, com duração ajustável nas configurações.
- Integração futura com Google Agenda, confirmação por e-mail e Meta após reserva real confirmada.
- Qualificação: faturamento até R$ 30 mil ou recusa de investir pelo menos R$ 2.000/mês em anúncios leva à oferta de estruturação e otimização do Google Meu Negócio. O investimento exclui a gestão da gatu.digital.
- Trabalhar por etapas. Finalizar e validar localmente antes do deploy. O painel usa login e SQLite local, e a prévia não envia dados reais.
