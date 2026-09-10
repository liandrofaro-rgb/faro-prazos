import { createClient } from "jsr:@supabase/supabase-js@2";

const DJEN_API = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";
const TIMEZONE = "America/Belem";
const MAX_PAGES_PER_QUERY = 10;

const CONSULTAS = [
  { numeroOab: "14611", ufOab: "PA" },
  { numeroOab: "1311", ufOab: "AP" },
  { nomeAdvogado: "LIANDRO MOREIRA DA CUNHA FARO" }
] as const;

type DjenItem = Record<string, unknown> & {
  id?: number;
  hash?: string;
  numeroComunicacao?: number;
  numero_processo?: string;
  numeroprocessocommascara?: string;
  siglaTribunal?: string;
  nomeOrgao?: string;
  tipoComunicacao?: string;
  tipoDocumento?: string;
  meio?: string;
  texto?: string;
  link?: string;
  data_disponibilizacao?: string;
  datadisponibilizacao?: string;
  destinatarios?: Array<{ nome?: string; polo?: string }>;
  destinatarioadvogados?: Array<{
    advogado?: { nome?: string; numero_oab?: string; uf_oab?: string };
  }>;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function normalizar(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function limparHtml(value: unknown) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function dateFromISO(value: string) {
  return new Date(`${value}T12:00:00-03:00`);
}

function isoDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function addCalendarDays(value: string, days: number) {
  const date = dateFromISO(value);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function addWeekdays(value: string, days: number) {
  const date = dateFromISO(value);
  let count = 0;
  while (count < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return isoDate(date);
}

function proximoDiaUtil(value: string) {
  return addWeekdays(value, 1);
}

function prazoExpresso(texto: string) {
  const patterns = [
    /(?:no|pelo|dentro do)?\s*prazo\s+(?:legal\s+)?de\s+(\d{1,3})\s*\(?\s*dias?/i,
    /em\s+(\d{1,3})\s*\(?\s*dias?\s*(?:uteis|úteis)?\s*,?\s*(?:para|a fim de)/i,
    /(?:manifestar(?:-se)?|contestar|responder|emendar|impugnar)\s+(?:no\s+)?prazo\s+de\s+(\d{1,3})\s*dias?/i
  ];
  for (const pattern of patterns) {
    const match = texto.match(pattern);
    if (!match) continue;
    const dias = Number(match[1]);
    if (Number.isInteger(dias) && dias > 0 && dias <= 180) return dias;
  }
  return null;
}

function tipoProvidencia(texto: string) {
  const tipos: Array<[RegExp, string]> = [
    [/contest(?:ar|acao|ação)/i, "Apresentar contestação"],
    [/contrarrazoes|contrarrazões/i, "Apresentar contrarrazões"],
    [/embargos?\s+de\s+declaracao|embargos?\s+de\s+declaração/i, "Avaliar embargos de declaração"],
    [/apelacao|apelação/i, "Avaliar ou apresentar apelação"],
    [/agravo/i, "Avaliar ou apresentar agravo"],
    [/impugn(?:ar|acao|ação)/i, "Apresentar impugnação"],
    [/replica|réplica/i, "Apresentar réplica"],
    [/emend(?:ar|a)\s+(?:a\s+)?(?:peticao|petição|inicial)/i, "Emendar a petição inicial"],
    [/manifest(?:ar|acao|ação)/i, "Apresentar manifestação"],
    [/cumpr(?:ir|imento)/i, "Cumprir determinação judicial"],
    [/recurso/i, "Avaliar ou apresentar recurso"]
  ];
  return tipos.find(([pattern]) => pattern.test(texto))?.[1] || "Analisar providência e possível prazo";
}

function temIndicadorDePrazo(texto: string, tipoComunicacao: string) {
  const indicadores = /intimad[oa]s?|fica[mr]?\s+intimad|manifest(?:ar|acao|ação)|contest(?:ar|acao|ação)|contrarrazoes|contrarrazões|recurso|apelacao|apelação|agravo|embargos?|impugn(?:ar|acao|ação)|replica|réplica|emend(?:ar|a)|cumpr(?:ir|imento)|prazo\s+(?:legal\s+)?de/i;
  return indicadores.test(texto) && /intimacao|intimação|citacao|citação|decisao|decisão|despacho|acordao|acórdão/i.test(`${tipoComunicacao} ${texto}`);
}

function partes(item: DjenItem) {
  const destinatarios = Array.isArray(item.destinatarios) ? item.destinatarios : [];
  const autor = destinatarios.find((p) => p?.polo === "A")?.nome || "";
  const reu = destinatarios.find((p) => p?.polo === "P")?.nome || "";
  return { autor, reu };
}

function oabEncontrada(item: DjenItem) {
  const advogados = Array.isArray(item.destinatarioadvogados) ? item.destinatarioadvogados : [];
  const exato = advogados.find(({ advogado }) =>
    normalizar(advogado?.nome) === normalizar("LIANDRO MOREIRA DA CUNHA FARO")
  )?.advogado;
  if (!exato) return "";
  return [exato.numero_oab, exato.uf_oab].filter(Boolean).join("/");
}

function correspondeAoAdvogado(item: DjenItem) {
  const advogados = Array.isArray(item.destinatarioadvogados) ? item.destinatarioadvogados : [];
  return advogados.some(({ advogado }) => {
    const nome = normalizar(advogado?.nome);
    const numero = String(advogado?.numero_oab || "").replace(/\D/g, "");
    const uf = String(advogado?.uf_oab || "").toUpperCase();
    return nome === normalizar("LIANDRO MOREIRA DA CUNHA FARO")
      || (numero === "14611" && uf === "PA")
      || (numero === "1311" && uf === "AP");
  });
}

function fonteId(item: DjenItem) {
  if (item.numeroComunicacao) return `numero:${item.numeroComunicacao}`;
  if (item.hash) return `hash:${item.hash}`;
  if (item.id) return `id:${item.id}`;
  return [item.numero_processo, item.data_disponibilizacao, item.tipoComunicacao]
    .map((value) => normalizar(value))
    .join(":");
}

function transformar(item: DjenItem) {
  if (!correspondeAoAdvogado(item)) return null;
  const texto = limparHtml(item.texto);
  const tipo = String(item.tipoComunicacao || "");
  const dias = prazoExpresso(texto);
  if (!dias && !temIndicadorDePrazo(texto, tipo)) return null;

  const disponibilizacao = String(item.data_disponibilizacao || item.datadisponibilizacao || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(disponibilizacao)) return null;

  const publicacao = proximoDiaUtil(disponibilizacao);
  const vencimento = dias ? addWeekdays(publicacao, dias) : null;
  const providencia = tipoProvidencia(texto);
  const { autor, reu } = partes(item);

  return {
    fonte_id: fonteId(item),
    hash: item.hash || null,
    numero_comunicacao: item.numeroComunicacao || null,
    numero_processo: item.numeroprocessocommascara || item.numero_processo || null,
    sigla_tribunal: item.siglaTribunal || null,
    nome_orgao: item.nomeOrgao || null,
    autor: autor || null,
    reu: reu || null,
    tipo_comunicacao: tipo || null,
    tipo_documento: item.tipoDocumento || null,
    meio: item.meio || null,
    texto,
    resumo: texto.length > 520 ? `${texto.slice(0, 517)}...` : texto,
    descricao_sugerida: dias ? `${providencia} · ${dias} dias úteis (a conferir)` : providencia,
    link: item.link || null,
    data_disponibilizacao: disponibilizacao,
    data_publicacao_preliminar: publicacao,
    prazo_dias: dias,
    data_vencimento_preliminar: vencimento,
    classificacao: dias ? "prazo_expresso" : "possivel_prazo",
    status: "pendente",
    oab_encontrada: oabEncontrada(item) || null,
    destinatarios: item.destinatarios || [],
    dados_origem: item
  };
}

async function consultarDjen(inicio: string, fim: string) {
  const encontrados = new Map<string, DjenItem>();
  const falhas: string[] = [];

  for (const consulta of CONSULTAS) {
    for (let pagina = 1; pagina <= MAX_PAGES_PER_QUERY; pagina += 1) {
      const params = new URLSearchParams({
        ...consulta,
        dataDisponibilizacaoInicio: inicio,
        dataDisponibilizacaoFim: fim,
        meio: "D",
        pagina: String(pagina),
        itensPorPagina: "100"
      });

      const response = await fetch(`${DJEN_API}?${params.toString()}`, {
        headers: { accept: "application/json", "user-agent": "Faro-Prazos/1.0" }
      });

      if (!response.ok) {
        falhas.push(`${JSON.stringify(consulta)}: HTTP ${response.status}`);
        break;
      }

      const payload = await response.json();
      const items = Array.isArray(payload?.items) ? payload.items as DjenItem[] : [];
      items.forEach((item) => encontrados.set(fonteId(item), item));
      if (items.length < 100) break;
    }
  }

  return { items: [...encontrados.values()], falhas };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "Método não permitido" });

  const cronSecret = Deno.env.get("DJEN_CRON_SECRET");
  if (!cronSecret) return json(503, { error: "DJEN_CRON_SECRET não configurado" });
  if (request.headers.get("x-cron-secret") !== cronSecret) return json(401, { error: "Não autorizado" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json(503, { error: "Supabase não configurado" });

  const hoje = isoDate(new Date());
  const inicio = addCalendarDays(hoje, -7);
  const { items, falhas } = await consultarDjen(inicio, hoje);
  const candidatos = items.map(transformar).filter(Boolean);

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let inseridos = 0;
  let atualizados = 0;
  const erros: string[] = [];

  for (const candidato of candidatos) {
    const { data: existente } = await supabase
      .from("publicacoes_djen")
      .select("id,status")
      .eq("fonte_id", candidato!.fonte_id)
      .maybeSingle();

    if (existente?.id) {
      if (existente.status === "pendente") {
        const { error } = await supabase
          .from("publicacoes_djen")
          .update(candidato!)
          .eq("id", existente.id);
        if (error) erros.push(`${candidato!.fonte_id}: ${error.message}`);
        else atualizados += 1;
      }
      continue;
    }

    const { error } = await supabase.from("publicacoes_djen").insert(candidato!);
    if (error) erros.push(`${candidato!.fonte_id}: ${error.message}`);
    else inseridos += 1;
  }

  return json(erros.length ? 207 : 200, {
    periodo: { inicio, fim: hoje },
    comunicacoes_consultadas: items.length,
    candidatos_a_prazo: candidatos.length,
    inseridos,
    atualizados,
    falhas_consulta: falhas,
    erros_banco: erros,
    aviso: "Datas e prazos são preliminares e dependem de revisão humana e do calendário do tribunal."
  });
});
