import { confirmActionDialog } from '../components/ConfirmDialog';
import { apiOpenExternalUrl, isTauriRuntime } from './tauri';

const KNOWN_TECHNICAL_TERMS = [
  'ファインチューニング',
  'プロンプトエンジニアリング',
  'ベクトルデータベース',
  'ハルシネーション',
  'トランスフォーマー',
  'アテンション機構',
  'マルチモーダル',
  'マイクロサービス',
  'リファクタリング',
  'スケーラビリティ',
  'デューデリジェンス',
  'コンプライアンス',
  'シンギュラリティ',
  'ブロックチェーン',
  'オーケストレーション',
  'トランザクション',
  'レプリケーション',
  'アーキテクチャ',
  'アルゴリズム',
  'エンベディング',
  'ゼロショット',
  'フューショット',
  'スループット',
  'イテレーション',
  'ミドルウェア',
  'フレームワーク',
  'ガバナンス',
  'レイテンシ',
  'プロトタイプ',
  'シャーディング',
  'WebAssembly',
  'TypeScript',
  'Kubernetes',
  'GraphQL',
  'WebSocket',
  'OAuth',
  'OpenAI',
  'Docker',
  'Tauri',
  'NoSQL',
  'CI/CD',
  '量子化',
  'RAG',
  'LLM',
  'API',
  'SDK',
  'KPI',
  'OKR',
  'ROI',
  'SaaS',
  'PaaS',
  'IaaS',
  'CRUD',
  'JWT',
  'TLS',
  'SSL',
  'REST',
  'SQL',
  'NLP',
  'GPU',
  'NPU',
  'VRAM',
  'OCR',
  'ASR',
  'TTS',
  'STT',
  'MCP',
  'CORS',
  'CSP',
  'PKCE',
  'SSO',
  'MFA',
  'RBAC',
  'GDPR',
  'NDA',
  'SLA',
  'MVP',
  'PMF',
  'LTV',
  'CAC',
  'MRR',
  'ARR',
  'PDCA',
];

const SUFFIX_KATAKANA_RE =
  '[ァ-ヶー]{2,}(?:アルゴリズム|アーキテクチャ|プロトコル|インターフェース|フレームワーク|スケーラビリティ|コンプライアンス|トランザクション|エンジニアリング)';

const escapedKnown = KNOWN_TECHNICAL_TERMS.map((t) =>
  t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
).sort((a, b) => b.length - a.length);

const TERM_REGEX = new RegExp(
  `(?<![A-Za-z0-9_])(${escapedKnown.join('|')}|${SUFFIX_KATAKANA_RE})(?![A-Za-z0-9_])`,
  'g'
);

export interface WikiTextPart {
  text: string;
  term?: string;
}

export function splitTextWithWikiTerms(
  input: string,
  seenTerms?: Set<string>
): WikiTextPart[] {
  if (!input) return [{ text: input }];
  const parts: WikiTextPart[] = [];
  let lastIndex = 0;
  TERM_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TERM_REGEX.exec(input)) !== null) {
    const term = match[1];
    if (seenTerms && seenTerms.has(term)) {
      continue;
    }
    if (match.index > lastIndex) {
      parts.push({ text: input.slice(lastIndex, match.index) });
    }
    if (seenTerms) seenTerms.add(term);
    parts.push({ text: term, term });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < input.length) {
    parts.push({ text: input.slice(lastIndex) });
  }
  return parts.length > 0 ? parts : [{ text: input }];
}

export async function openWikipediaWithConfirm(term: string): Promise<void> {
  const url = `https://ja.wikipedia.org/wiki/${encodeURIComponent(term)}`;
  const ok = await confirmActionDialog(
    `「${term}」の Wikipedia ページを開きますか？`,
    url,
    'Wikipedia で開く'
  );
  if (!ok) return;
  if (isTauriRuntime()) {
    await apiOpenExternalUrl(url);
  } else if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
