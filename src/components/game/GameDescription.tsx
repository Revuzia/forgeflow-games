/**
 * Renders a registry description as TEXT ONLY, honouring the line breaks and
 * "- " bullet lists the pipeline writes into public.games.description.
 *
 * Before 2026-09-15 the detail page dropped the whole string into a single <p>,
 * so a 12-newline description (e.g. blackridge) collapsed into one run-on wall
 * of text and its "- LANTERNWALK ..." bullets ran inline mid-sentence.
 *
 * SECURITY: never render database text as HTML. Everything below goes through
 * React children (auto-escaped) — no dangerouslySetInnerHTML, no markdown-to-HTML.
 */

type Props = {
  text: string;
  className?: string;
};

type Block = { kind: "para"; lines: string[] } | { kind: "list"; items: string[] };

const BULLET = /^\s*[-*•·]\s+/;

export function parseDescription(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ kind: "para", lines: para });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: "list", items: list });
    list = [];
  };

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushList();
      flushPara();
      continue;
    }
    if (BULLET.test(line)) {
      flushPara();
      list.push(line.replace(BULLET, ""));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushList();
  flushPara();
  return blocks;
}

export default function GameDescription({ text, className = "" }: Props) {
  const blocks = parseDescription(text);
  if (!blocks.length) return null;

  return (
    <div className={className}>
      {blocks.map((block, i) =>
        block.kind === "list" ? (
          <ul key={i} className="list-disc pl-5 space-y-1 mb-3 marker:text-surface-500">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="mb-3 last:mb-0">
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        )
      )}
    </div>
  );
}
