# Faro Prazos

Controle interno de prazos processuais da Faro Advocacia & Consultoria.

## Integração automática com o DJEN

A integração consulta a API pública do DJEN por:

- LIANDRO MOREIRA DA CUNHA FARO;
- OAB/PA 14.611-A, consultada como `14611/PA`;
- OAB/AP 1.311, consultada como `1311/AP`.

Somente comunicações classificadas como **prazo expresso** ou **possível prazo** são gravadas. Todo resultado entra com status `pendente` e exige revisão humana antes de virar um prazo ativo.

### Componentes

- `supabase/migrations/202609100001_publicacoes_djen.sql`: tabela, índices e políticas de segurança;
- `supabase/functions/importar-djen/index.ts`: consulta, classificação preliminar e prevenção de duplicidades;
- aba **DJEN** no `index.html`: revisão, descarte e preenchimento assistido do cadastro de prazo.

### Ativação no Supabase

1. Vincule o projeto local ao projeto Supabase do Faro Prazos.
2. Aplique a migração:

   ```bash
   supabase db push
   ```

3. Cadastre um segredo longo e aleatório para proteger a execução automática:

   ```bash
   supabase secrets set DJEN_CRON_SECRET="substitua-por-um-segredo-forte"
   ```

4. Publique a função:

   ```bash
   supabase functions deploy importar-djen --no-verify-jwt
   ```

5. No Supabase Cron, programe uma chamada `POST` à função `importar-djen` às **10h30 UTC, de segunda a sexta-feira**, equivalente a 7h30 em Belém. Envie o cabeçalho `x-cron-secret` com o mesmo valor configurado em `DJEN_CRON_SECRET`.

### Regra de segurança jurídica

As datas de publicação e vencimento produzidas pela função são preliminares. A rotina automática considera apenas dias de semana e não substitui a conferência de feriados locais, suspensões de expediente, modalidade da intimação, prazo aplicável e calendário oficial do tribunal.
